import { Router } from 'express';
import { z } from 'zod';
import { getDb, runInTransaction } from '../db/database.js';
import { hashPassword, requireAuth, requireRole } from '../middleware/auth.js';
import { assignDispatcherToOrder, rankDispatchersForOrder } from '../services/dispatch.js';
import {
  executeAdminRefund,
  formatNairaServer,
  getPlatformSettings,
  writeFinancialAuditLog,
} from '../services/payment.js';
import { broadcastOrderUpdate, createNotification } from '../services/events.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

function slugify(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
    '-' +
    Math.floor(100 + Math.random() * 900)
  );
}

// --- OVERVIEW & ANALYTICS ---
router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const db = getDb();

    const [
      kpiRow,
      walletRow,
      stlRow,
      dspRow,
      ordersByStatus,
      coverageByState,
      retailerRevenueRank,
      recentOrders,
    ] = await Promise.all([
      db.get<Record<string, number>>(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE role = 'CUSTOMER') as total_customers,
          (SELECT COUNT(*) FROM retailers) as total_retailers,
          (SELECT COUNT(*) FROM retailers WHERE status = 'APPROVED_ACTIVE') as active_retailers,
          (SELECT COUNT(*) FROM retailers WHERE status = 'PENDING_APPROVAL') as pending_retailers,
          (SELECT COUNT(*) FROM users WHERE role = 'DISPATCHER') as total_dispatchers,
          (SELECT COUNT(*) FROM dispatcher_profiles dp JOIN users u ON u.id = dp.user_id WHERE u.status = 'ACTIVE' AND dp.availability_status IN ('ONLINE', 'BUSY')) as active_dispatchers,
          (SELECT COUNT(*) FROM orders) as total_orders,
          (SELECT COUNT(*) FROM orders WHERE status = 'AWAITING_DISPATCHER_ASSIGNMENT') as awaiting_assignment,
          (SELECT COUNT(*) FROM orders WHERE status IN ('ASSIGNED_TO_DISPATCHER', 'ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT')) as active_deliveries,
          (SELECT COUNT(*) FROM orders WHERE status = 'DELIVERED') as completed_deliveries,
          (SELECT COUNT(*) FROM orders WHERE status = 'DELIVERY_FAILED') as failed_deliveries,
          (SELECT COUNT(*) FROM complaints WHERE status IN ('OPEN', 'IN_REVIEW')) as open_complaints,
          (SELECT COALESCE(SUM(total_amount_kobo), 0) FROM orders WHERE payment_status = 'PAID') as gross_order_volume_kobo,
          (SELECT COALESCE(SUM(platform_margin_kobo + delivery_fee_kobo), 0) FROM orders WHERE payment_status = 'PAID') as platform_revenue_kobo
      `),
      db.get<{ s: number }>('SELECT COALESCE(SUM(balance_kobo), 0) as s FROM wallets'),
      db.get<{ s: number }>(
        "SELECT COALESCE(SUM(agreed_retailer_payout_kobo), 0) as s FROM retailer_settlements WHERE status IN ('PENDING', 'APPROVED')"
      ),
      db.get<{ s: number }>(
        "SELECT COALESCE(SUM(total_earning_kobo), 0) as s FROM dispatcher_earnings WHERE status IN ('PENDING', 'APPROVED')"
      ),
      db.all('SELECT status, COUNT(*) as count FROM orders GROUP BY status ORDER BY count DESC'),
      db.all(`
        SELECT state, city,
               COUNT(*) as total_retailers,
               SUM(CASE WHEN status = 'APPROVED_ACTIVE' THEN 1 ELSE 0 END) as active_retailers,
               AVG(max_delivery_radius_km) as avg_radius_km
        FROM retailers
        GROUP BY state, city
        ORDER BY total_retailers DESC
      `),
      db.all(`
        SELECT r.id, r.business_name, r.neighbourhood, r.city,
               COUNT(o.id) as orders_count,
               COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.total_amount_kobo ELSE 0 END), 0) as gmv_kobo,
               COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.platform_margin_kobo ELSE 0 END), 0) as margin_kobo
        FROM retailers r
        LEFT JOIN orders o ON o.retailer_id = r.id
        GROUP BY r.id, r.business_name, r.neighbourhood, r.city
        ORDER BY gmv_kobo DESC
        LIMIT 8
      `),
      db.all(`
        SELECT o.id, o.order_reference, o.status, o.payment_method, o.payment_status, o.total_amount_kobo,
               o.delivery_neighbourhood, o.delivery_city, o.created_at,
               c.full_name as customer_name, r.business_name as retailer_name, d.full_name as dispatcher_name
        FROM orders o
        JOIN users c ON c.id = o.customer_id
        JOIN retailers r ON r.id = o.retailer_id
        LEFT JOIN users d ON d.id = o.dispatcher_id
        ORDER BY o.created_at DESC
        LIMIT 10
      `),
    ]);

    const kpis = {
      totalCustomers: Number(kpiRow?.total_customers || 0),
      totalRetailers: Number(kpiRow?.total_retailers || 0),
      activeRetailers: Number(kpiRow?.active_retailers || 0),
      pendingRetailers: Number(kpiRow?.pending_retailers || 0),
      totalDispatchers: Number(kpiRow?.total_dispatchers || 0),
      activeDispatchers: Number(kpiRow?.active_dispatchers || 0),
      totalOrders: Number(kpiRow?.total_orders || 0),
      awaitingAssignment: Number(kpiRow?.awaiting_assignment || 0),
      activeDeliveries: Number(kpiRow?.active_deliveries || 0),
      completedDeliveries: Number(kpiRow?.completed_deliveries || 0),
      failedDeliveries: Number(kpiRow?.failed_deliveries || 0),
      openComplaints: Number(kpiRow?.open_complaints || 0),
      grossOrderVolumeKobo: Number(kpiRow?.gross_order_volume_kobo || 0),
      platformRevenueKobo: Number(kpiRow?.platform_revenue_kobo || 0),
      pendingRetailerSettlementsKobo: Number(stlRow?.s || 0),
      pendingDispatcherPayoutsKobo: Number(dspRow?.s || 0),
      totalCustomerWalletLiabilityKobo: Number(walletRow?.s || 0),
    };

    res.json({ kpis, ordersByStatus, coverageByState, retailerRevenueRank, recentOrders });
  })
);

// --- RETAILER MANAGEMENT (EXCLUSIVE TO ADMIN — NO RETAILER ACCOUNTS) ---
router.get(
  '/retailers',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const retailers = await db.all(`
      SELECT r.*,
             (SELECT COUNT(*) FROM retailer_products rp WHERE rp.retailer_id = r.id AND rp.is_available = 1) as active_products_count,
             (SELECT COUNT(*) FROM orders o WHERE o.retailer_id = r.id) as total_orders
      FROM retailers r
      ORDER BY r.created_at DESC
    `);
    res.json({ retailers });
  })
);

const retailerSchema = z.object({
  businessName: z.string().min(2).max(160),
  contactPerson: z.string().min(2).max(120),
  phone: z.string().min(8).max(30),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().min(4).max(240),
  neighbourhood: z.string().min(2).max(100),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  lat: z.number(),
  lng: z.number(),
  logoUrl: z.string().max(400).optional(),
  coverImageUrl: z.string().max(400).optional(),
  description: z.string().max(1000).optional(),
  operatingHours: z.record(z.string()).optional(),
  isOpenNow: z.boolean().optional(),
  maxDeliveryRadiusKm: z.number().min(1).max(60),
  coverageAreas: z.array(z.string()),
  baseDeliveryFeeNaira: z.number().min(0).max(50000),
  perKmDeliveryFeeNaira: z.number().min(0).max(10000),
  estimatedPrepMins: z.number().int().min(5).max(120).optional(),
  status: z.enum(['APPROVED_ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL']).optional(),
  featured: z.boolean().optional(),
});

router.post(
  '/retailers',
  asyncHandler(async (req, res) => {
    const parsed = retailerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid retailer data.' });
      return;
    }
    const d = parsed.data;
    const db = getDb();
    const slug = slugify(d.businessName);
    const info = await db.run(
      `
      INSERT INTO retailers (
        business_name, slug, contact_person, phone, email, address, neighbourhood, city, state,
        lat, lng, logo_url, cover_image_url, description, operating_hours_json, is_open_now,
        max_delivery_radius_km, coverage_areas_json, base_delivery_fee_kobo, per_km_delivery_fee_kobo,
        estimated_prep_mins, status, featured, created_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      d.businessName.trim(),
      slug,
      d.contactPerson.trim(),
      d.phone.trim(),
      d.email?.trim() || '',
      d.address.trim(),
      d.neighbourhood.trim(),
      d.city.trim(),
      d.state.trim(),
      d.lat,
      d.lng,
      d.logoUrl?.trim() || '',
      d.coverImageUrl?.trim() || '/images/depot-ewet.jpg',
      d.description?.trim() || '',
      JSON.stringify(d.operatingHours || { mon_fri: '07:00 - 20:00', sat: '08:00 - 19:00', sun: '09:00 - 17:00' }),
      d.isOpenNow === false ? 0 : 1,
      d.maxDeliveryRadiusKm,
      JSON.stringify(d.coverageAreas.map((a) => a.trim()).filter(Boolean)),
      Math.round(d.baseDeliveryFeeNaira * 100),
      Math.round(d.perKmDeliveryFeeNaira * 100),
      d.estimatedPrepMins ?? 14,
      d.status || 'APPROVED_ACTIVE',
      d.featured ? 1 : 0,
      req.user!.id
    );

    const retailer = await db.get('SELECT * FROM retailers WHERE id = ?', Number(info.lastInsertRowid));
    res.status(201).json({ retailer });
  })
);

router.patch(
  '/retailers/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const existing = await db.get('SELECT * FROM retailers WHERE id = ?', id);
    if (!existing) {
      res.status(404).json({ error: 'Retailer not found.' });
      return;
    }

    const b = req.body || {};
    await db.run(
      `
      UPDATE retailers
      SET business_name = COALESCE(?, business_name),
          contact_person = COALESCE(?, contact_person),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          address = COALESCE(?, address),
          neighbourhood = COALESCE(?, neighbourhood),
          city = COALESCE(?, city),
          state = COALESCE(?, state),
          lat = COALESCE(?, lat),
          lng = COALESCE(?, lng),
          logo_url = COALESCE(?, logo_url),
          cover_image_url = COALESCE(?, cover_image_url),
          description = COALESCE(?, description),
          operating_hours_json = COALESCE(?, operating_hours_json),
          is_open_now = COALESCE(?, is_open_now),
          max_delivery_radius_km = COALESCE(?, max_delivery_radius_km),
          coverage_areas_json = COALESCE(?, coverage_areas_json),
          base_delivery_fee_kobo = COALESCE(?, base_delivery_fee_kobo),
          per_km_delivery_fee_kobo = COALESCE(?, per_km_delivery_fee_kobo),
          estimated_prep_mins = COALESCE(?, estimated_prep_mins),
          status = COALESCE(?, status),
          featured = COALESCE(?, featured),
          updated_at = datetime('now')
      WHERE id = ?
    `,
      b.businessName ?? null,
      b.contactPerson ?? null,
      b.phone ?? null,
      b.email ?? null,
      b.address ?? null,
      b.neighbourhood ?? null,
      b.city ?? null,
      b.state ?? null,
      b.lat !== undefined ? Number(b.lat) : null,
      b.lng !== undefined ? Number(b.lng) : null,
      b.logoUrl ?? null,
      b.coverImageUrl ?? null,
      b.description ?? null,
      b.operatingHours ? JSON.stringify(b.operatingHours) : null,
      b.isOpenNow !== undefined ? (b.isOpenNow ? 1 : 0) : null,
      b.maxDeliveryRadiusKm !== undefined ? Number(b.maxDeliveryRadiusKm) : null,
      Array.isArray(b.coverageAreas) ? JSON.stringify(b.coverageAreas) : null,
      b.baseDeliveryFeeNaira !== undefined ? Math.round(Number(b.baseDeliveryFeeNaira) * 100) : null,
      b.perKmDeliveryFeeNaira !== undefined ? Math.round(Number(b.perKmDeliveryFeeNaira) * 100) : null,
      b.estimatedPrepMins !== undefined ? Number(b.estimatedPrepMins) : null,
      b.status ?? null,
      b.featured !== undefined ? (b.featured ? 1 : 0) : null,
      id
    );

    const retailer = await db.get('SELECT * FROM retailers WHERE id = ?', id);
    res.json({ retailer });
  })
);

router.delete(
  '/retailers/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const cntRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM orders WHERE retailer_id = ?', id);
    if (Number(cntRow?.c || 0) > 0) {
      await db.run("UPDATE retailers SET status = 'SUSPENDED', is_open_now = 0, updated_at = datetime('now') WHERE id = ?", id);
      res.json({
        ok: true,
        softDeactivated: true,
        message: 'Retailer has historical orders and was suspended to preserve audit records.',
      });
      return;
    }
    await db.run('DELETE FROM retailers WHERE id = ?', id);
    res.json({ ok: true });
  })
);

// --- PRODUCTS & INDEPENDENT PER-RETAILER PRICING ---
router.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const [categories, products] = await Promise.all([
      db.all('SELECT * FROM product_categories ORDER BY sort_order ASC'),
      db.all(`
        SELECT p.*, pc.name as category_name, pc.type as category_type,
               (SELECT COUNT(*) FROM retailer_products rp WHERE rp.product_id = p.id) as assigned_retailers_count
        FROM products p
        JOIN product_categories pc ON pc.id = p.category_id
        ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
      `),
    ]);
    res.json({ categories, products });
  })
);

router.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().min(2).max(80),
      type: z.enum(['GAS_REFILL', 'CYLINDER', 'ACCESSORY']),
      description: z.string().max(300).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category.' });
      return;
    }
    const db = getDb();
    const info = await db.run(
      'INSERT INTO product_categories (name, slug, type, description) VALUES (?, ?, ?, ?)',
      parsed.data.name.trim(),
      slugify(parsed.data.name),
      parsed.data.type,
      parsed.data.description?.trim() || ''
    );
    const category = await db.get('SELECT * FROM product_categories WHERE id = ?', Number(info.lastInsertRowid));
    res.status(201).json({ category });
  })
);

router.post(
  '/products',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      categoryId: z.number().int().positive(),
      name: z.string().min(2).max(120),
      sizeKg: z.number().positive().nullable().optional(),
      unitLabel: z.string().min(1).max(40),
      description: z.string().max(600).optional(),
      imageUrl: z.string().max(400).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid product.' });
      return;
    }
    const d = parsed.data;
    const db = getDb();
    const info = await db.run(
      `
      INSERT INTO products (category_id, name, slug, size_kg, unit_label, description, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      d.categoryId,
      d.name.trim(),
      slugify(d.name),
      d.sizeKg ?? null,
      d.unitLabel.trim(),
      d.description?.trim() || '',
      d.imageUrl?.trim() || '/images/prod-refill-12-5kg.jpg'
    );
    const product = await db.get('SELECT * FROM products WHERE id = ?', Number(info.lastInsertRowid));
    res.status(201).json({ product });
  })
);

router.patch(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body || {};
    await db.run(
      `
      UPDATE products
      SET name = COALESCE(?, name),
          unit_label = COALESCE(?, unit_label),
          description = COALESCE(?, description),
          image_url = COALESCE(?, image_url),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `,
      b.name ?? null,
      b.unitLabel ?? null,
      b.description ?? null,
      b.imageUrl ?? null,
      b.isActive !== undefined ? (b.isActive ? 1 : 0) : null,
      id
    );
    const product = await db.get('SELECT * FROM products WHERE id = ?', id);
    res.json({ product });
  })
);

router.get(
  '/retailers/:id/products',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const items = await db.all(
      `
      SELECT rp.*, p.name as product_name, p.size_kg, p.unit_label, p.image_url, pc.name as category_name, pc.type as category_type
      FROM retailer_products rp
      JOIN products p ON p.id = rp.product_id
      JOIN product_categories pc ON pc.id = p.category_id
      WHERE rp.retailer_id = ?
      ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
    `,
      Number(req.params.id)
    );
    res.json({ items });
  })
);

router.put(
  '/retailers/:id/products',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      productId: z.number().int().positive(),
      sellingPriceNaira: z.number().positive(),
      retailerSupplyCostNaira: z.number().min(0),
      stockQuantity: z.number().int().min(0),
      isAvailable: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid retailer pricing input.' });
      return;
    }
    const db = getDb();
    const retailerId = Number(req.params.id);
    const d = parsed.data;
    const sellKobo = Math.round(d.sellingPriceNaira * 100);
    const supplyKobo = Math.round(d.retailerSupplyCostNaira * 100);

    await db.run(
      `
      INSERT INTO retailer_products (retailer_id, product_id, selling_price_kobo, retailer_supply_cost_kobo, stock_quantity, is_available, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(retailer_id, product_id) DO UPDATE SET
        selling_price_kobo = excluded.selling_price_kobo,
        retailer_supply_cost_kobo = excluded.retailer_supply_cost_kobo,
        stock_quantity = excluded.stock_quantity,
        is_available = excluded.is_available,
        updated_at = datetime('now')
    `,
      retailerId,
      d.productId,
      sellKobo,
      supplyKobo,
      d.stockQuantity,
      d.isAvailable ? 1 : 0
    );

    res.json({ ok: true });
  })
);

router.delete(
  '/retailers/:id/products/:productId',
  asyncHandler(async (req, res) => {
    const db = getDb();
    await db.run(
      'DELETE FROM retailer_products WHERE retailer_id = ? AND product_id = ?',
      Number(req.params.id),
      Number(req.params.productId)
    );
    res.json({ ok: true });
  })
);

// --- CUSTOMER MANAGEMENT ---
router.get(
  '/customers',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const customers = await db.all(`
      SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
             COALESCE(w.balance_kobo, 0) as wallet_balance_kobo,
             (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) as orders_count,
             (SELECT COALESCE(SUM(o.total_amount_kobo), 0) FROM orders o WHERE o.customer_id = u.id AND o.payment_status = 'PAID') as total_spent_kobo
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE u.role = 'CUSTOMER'
      ORDER BY u.created_at DESC
    `);
    res.json({ customers });
  })
);

router.post(
  '/customers',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      fullName: z.string().min(2).max(120),
      email: z.string().email(),
      phone: z.string().min(8).max(25),
      password: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid customer data.' });
      return;
    }
    const db = getDb();
    const email = parsed.data.email.trim().toLowerCase();
    if (await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', email)) {
      res.status(409).json({ error: 'Email already registered.' });
      return;
    }
    const created = await runInTransaction(async (tdb) => {
      const info = await tdb.run(
        "INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('CUSTOMER', ?, ?, ?, ?, 'ACTIVE')",
        parsed.data.fullName.trim(),
        email,
        parsed.data.phone.trim(),
        hashPassword(parsed.data.password)
      );
      const id = Number(info.lastInsertRowid);
      await tdb.run('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, 0)', id);
      return await tdb.get('SELECT id, full_name, email, phone, status, created_at FROM users WHERE id = ?', id);
    });
    res.status(201).json({ customer: created });
  })
);

router.patch(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const b = req.body || {};
    await db.run(
      `
      UPDATE users
      SET full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          status = COALESCE(?, status),
          updated_at = datetime('now')
      WHERE id = ? AND role = 'CUSTOMER'
    `,
      b.fullName ?? null,
      b.phone ?? null,
      b.status ?? null,
      id
    );
    res.json({ ok: true });
  })
);

// --- DISPATCHER MANAGEMENT (EXCLUSIVE CREATION BY ADMIN) ---
router.get(
  '/dispatchers',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const dispatchers = await db.all(`
      SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
             dp.vehicle_type, dp.plate_number, dp.license_number, dp.zone,
             dp.availability_status, dp.current_lat, dp.current_lng,
             dp.location_tracking_enabled, dp.location_updated_at,
             dp.compensation_model, dp.base_rate_kobo, dp.per_km_rate_kobo,
             dp.rating_avg, dp.completed_deliveries_count,
             (SELECT COUNT(*) FROM orders o WHERE o.dispatcher_id = u.id AND o.status IN ('ASSIGNED_TO_DISPATCHER', 'ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT')) as active_jobs_count,
             (SELECT COALESCE(SUM(de.total_earning_kobo), 0) FROM dispatcher_earnings de WHERE de.dispatcher_id = u.id AND de.status != 'REVERSED') as total_earned_kobo
      FROM users u
      JOIN dispatcher_profiles dp ON dp.user_id = u.id
      WHERE u.role = 'DISPATCHER'
      ORDER BY u.created_at DESC
    `);
    res.json({ dispatchers });
  })
);

router.post(
  '/dispatchers',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      fullName: z.string().min(2).max(120),
      email: z.string().email(),
      phone: z.string().min(8).max(25),
      password: z.string().min(8),
      vehicleType: z.string().min(2).max(80),
      plateNumber: z.string().min(3).max(30),
      licenseNumber: z.string().min(3).max(50),
      zone: z.string().min(2).max(100),
      compensationModel: z.enum(['FIXED', 'DISTANCE', 'ZONE', 'FIXED_PLUS_DISTANCE']).optional(),
      baseRateNaira: z.number().min(100).max(50000).optional(),
      perKmRateNaira: z.number().min(0).max(5000).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid dispatcher details.' });
      return;
    }
    const d = parsed.data;
    const db = getDb();
    const email = d.email.trim().toLowerCase();
    if (await db.get('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', email)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const created = await runInTransaction(async (tdb) => {
      const info = await tdb.run(
        "INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('DISPATCHER', ?, ?, ?, ?, 'ACTIVE')",
        d.fullName.trim(),
        email,
        d.phone.trim(),
        hashPassword(d.password)
      );
      const userId = Number(info.lastInsertRowid);
      await tdb.run(
        `
        INSERT INTO dispatcher_profiles (
          user_id, vehicle_type, plate_number, license_number, zone, availability_status,
          current_lat, current_lng, compensation_model, base_rate_kobo, per_km_rate_kobo
        ) VALUES (?, ?, ?, ?, ?, 'ONLINE', ?, ?, ?, ?, ?)
      `,
        userId,
        d.vehicleType.trim(),
        d.plateNumber.trim().toUpperCase(),
        d.licenseNumber.trim().toUpperCase(),
        d.zone.trim(),
        d.lat ?? 5.0377,
        d.lng ?? 7.9128,
        d.compensationModel || 'FIXED_PLUS_DISTANCE',
        Math.round((d.baseRateNaira ?? 750) * 100),
        Math.round((d.perKmRateNaira ?? 75) * 100)
      );
      return userId;
    });

    res.status(201).json({ ok: true, dispatcherId: created });
  })
);

router.patch(
  '/dispatchers/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await runInTransaction(async (db) => {
      await db.run(
        `
        UPDATE users
        SET full_name = COALESCE(?, full_name),
            phone = COALESCE(?, phone),
            status = COALESCE(?, status),
            updated_at = datetime('now')
        WHERE id = ? AND role = 'DISPATCHER'
      `,
        b.fullName ?? null,
        b.phone ?? null,
        b.status ?? null,
        id
      );

      await db.run(
        `
        UPDATE dispatcher_profiles
        SET vehicle_type = COALESCE(?, vehicle_type),
            plate_number = COALESCE(?, plate_number),
            zone = COALESCE(?, zone),
            availability_status = COALESCE(?, availability_status),
            compensation_model = COALESCE(?, compensation_model),
            base_rate_kobo = COALESCE(?, base_rate_kobo),
            per_km_rate_kobo = COALESCE(?, per_km_rate_kobo)
        WHERE user_id = ?
      `,
        b.vehicleType ?? null,
        b.plateNumber ?? null,
        b.zone ?? null,
        b.availabilityStatus ?? null,
        b.compensationModel ?? null,
        b.baseRateNaira !== undefined ? Math.round(Number(b.baseRateNaira) * 100) : null,
        b.perKmRateNaira !== undefined ? Math.round(Number(b.perKmRateNaira) * 100) : null,
        id
      );
    });
    res.json({ ok: true });
  })
);

// --- ORDER MANAGEMENT & DISPATCH ASSIGNMENT ---
router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const statusFilter = typeof req.query.status === 'string' && req.query.status !== 'ALL' ? req.query.status : null;
    const sql = `
      SELECT o.*,
             c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone,
             r.business_name as retailer_name, r.address as retailer_address, r.phone as retailer_phone,
             r.lat as retailer_lat, r.lng as retailer_lng,
             d.full_name as dispatcher_name, d.phone as dispatcher_phone,
             dp.vehicle_type as dispatcher_vehicle, dp.plate_number as dispatcher_plate,
             dp.current_lat as dispatcher_lat, dp.current_lng as dispatcher_lng,
             dp.location_tracking_enabled as dispatcher_tracking_enabled
      FROM orders o
      JOIN users c ON c.id = o.customer_id
      JOIN retailers r ON r.id = o.retailer_id
      LEFT JOIN users d ON d.id = o.dispatcher_id
      LEFT JOIN dispatcher_profiles dp ON dp.user_id = o.dispatcher_id
      ${statusFilter ? 'WHERE o.status = ?' : ''}
      ORDER BY o.created_at DESC
    `;
    const orders = statusFilter
      ? await db.all<Record<string, unknown>>(sql, statusFilter)
      : await db.all<Record<string, unknown>>(sql);

    const orderIds = orders.map((o) => Number(o.id));
    const itemsByOrder = new Map<number, unknown[]>();
    const histByOrder = new Map<number, unknown[]>();
    if (orderIds.length > 0) {
      const ph = orderIds.map(() => '?').join(',');
      const [items, hist] = await Promise.all([
        db.all<{ order_id: number }>(`SELECT * FROM order_items WHERE order_id IN (${ph})`, ...orderIds),
        db.all<{ order_id: number }>(
          `SELECT * FROM order_status_history WHERE order_id IN (${ph}) ORDER BY created_at ASC`,
          ...orderIds
        ),
      ]);
      for (const it of items) {
        const oid = Number(it.order_id);
        const arr = itemsByOrder.get(oid) || [];
        arr.push(it);
        itemsByOrder.set(oid, arr);
      }
      for (const h of hist) {
        const oid = Number(h.order_id);
        const arr = histByOrder.get(oid) || [];
        arr.push(h);
        histByOrder.set(oid, arr);
      }
    }

    res.json({
      orders: orders.map((o) => ({
        ...o,
        items: itemsByOrder.get(Number(o.id)) || [],
        timeline: histByOrder.get(Number(o.id)) || [],
      })),
    });
  })
);

router.get(
  '/orders/:id/recommendations',
  asyncHandler(async (req, res) => {
    try {
      const candidates = await rankDispatchersForOrder(Number(req.params.id));
      res.json({ candidates });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  })
);

router.post(
  '/orders/:id/assign',
  asyncHandler(async (req, res) => {
    const orderId = Number(req.params.id);
    const autoAssign = Boolean(req.body?.autoAssign);
    let dispatcherId = req.body?.dispatcherId ? Number(req.body.dispatcherId) : 0;

    try {
      if (autoAssign) {
        const ranked = await rankDispatchersForOrder(orderId);
        const best = ranked.find((c) => c.availabilityStatus !== 'OFFLINE') || ranked[0];
        if (!best) {
          res.status(400).json({ error: 'No active dispatchers available for automatic assignment.' });
          return;
        }
        dispatcherId = best.dispatcherId;
      }

      if (!dispatcherId) {
        res.status(400).json({ error: 'Please select a dispatcher or enable auto-assignment.' });
        return;
      }

      const result = await assignDispatcherToOrder({
        orderId,
        dispatcherId,
        adminUserId: Number(req.user!.id),
        isAutoAssigned: autoAssign,
        note: req.body?.note,
      });
      res.json({ ok: true, ...result, autoAssigned: autoAssign });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  })
);

router.post(
  '/orders/:id/cancel',
  asyncHandler(async (req, res) => {
    const orderId = Number(req.params.id);
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Cancelled by Operations Administrator';
    const db = getDb();
    const order = await db.get<{
      id: number;
      order_reference: string;
      customer_id: number;
      dispatcher_id: number | null;
      status: string;
      payment_status: string;
    }>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (['DELIVERED', 'REFUNDED'].includes(order.status)) {
      res.status(400).json({ error: 'Delivered or already refunded orders cannot be cancelled.' });
      return;
    }

    await runInTransaction(async (tdb) => {
      await tdb.run(
        `UPDATE orders SET status = 'CANCELLED', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        order.id
      );
      await tdb.run(
        `
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
        VALUES (?, ?, 'CANCELLED', ?, 'ADMIN', ?)
      `,
        order.id,
        order.status,
        req.user!.id,
        reason
      );
    });

    await createNotification({
      userId: Number(order.customer_id),
      roleScope: 'CUSTOMER',
      title: 'Order Cancelled by Operations',
      message: `Order ${order.order_reference} has been cancelled. Reason: ${reason}.`,
      type: 'ORDER',
      relatedOrderId: Number(order.id),
    });
    if (order.dispatcher_id) {
      await createNotification({
        userId: Number(order.dispatcher_id),
        roleScope: 'DISPATCHER',
        title: 'Delivery Cancelled',
        message: `Order ${order.order_reference} was cancelled by Operations Admin.`,
        type: 'DISPATCH',
        relatedOrderId: Number(order.id),
      });
    }
    broadcastOrderUpdate(Number(order.id), Number(order.customer_id), order.dispatcher_id ? Number(order.dispatcher_id) : null, 'CANCELLED');
    res.json({ ok: true });
  })
);

// --- FINANCE, SETTLEMENTS, COMPENSATION, REFUNDS & AUDIT LOGS ---
router.get(
  '/finance/summary',
  asyncHandler(async (_req, res) => {
    const db = getDb();

    const [
      retailerSettlements,
      dispatcherEarnings,
      walletTransactions,
      gatewayTransactions,
      refunds,
      auditLogs,
      totalsRow,
    ] = await Promise.all([
      db.all(`
        SELECT rs.*, r.business_name as retailer_name, r.phone as retailer_phone,
               o.order_reference, o.status as order_status, o.created_at as order_date
        FROM retailer_settlements rs
        JOIN retailers r ON r.id = rs.retailer_id
        JOIN orders o ON o.id = rs.order_id
        ORDER BY rs.created_at DESC
      `),
      db.all(`
        SELECT de.*, u.full_name as dispatcher_name, u.phone as dispatcher_phone,
               o.order_reference, o.distance_km, o.delivered_at
        FROM dispatcher_earnings de
        JOIN users u ON u.id = de.dispatcher_id
        JOIN orders o ON o.id = de.order_id
        ORDER BY de.created_at DESC
      `),
      db.all(`
        SELECT wt.*, u.full_name as customer_name, u.email as customer_email
        FROM wallet_transactions wt
        JOIN users u ON u.id = wt.user_id
        ORDER BY wt.created_at DESC
        LIMIT 100
      `),
      db.all(`
        SELECT gt.*, u.full_name as customer_name, u.email as customer_email
        FROM gateway_transactions gt
        JOIN users u ON u.id = gt.user_id
        ORDER BY gt.created_at DESC
        LIMIT 100
      `),
      db.all(`
        SELECT rf.*, o.order_reference, u.full_name as customer_name, u.email as customer_email
        FROM refunds rf
        JOIN orders o ON o.id = rf.order_id
        JOIN users u ON u.id = rf.customer_id
        ORDER BY rf.created_at DESC
      `),
      db.all(`
        SELECT fal.*, u.full_name as actor_name
        FROM financial_audit_logs fal
        LEFT JOIN users u ON u.id = fal.actor_user_id
        ORDER BY fal.created_at DESC
        LIMIT 120
      `),
      db.get<Record<string, number>>(`
        SELECT
          (SELECT COALESCE(SUM(total_amount_kobo), 0) FROM orders WHERE payment_status = 'PAID') as total_customer_payments_kobo,
          (SELECT COALESCE(SUM(amount_kobo), 0) FROM wallet_transactions WHERE type = 'FUNDING' AND status = 'SUCCESS') as total_wallet_funding_kobo,
          (SELECT COALESCE(SUM(agreed_retailer_payout_kobo), 0) FROM retailer_settlements WHERE status IN ('PENDING', 'APPROVED')) as total_retailer_payouts_due_kobo,
          (SELECT COALESCE(SUM(agreed_retailer_payout_kobo), 0) FROM retailer_settlements WHERE status = 'PAID') as total_retailer_payouts_paid_kobo,
          (SELECT COALESCE(SUM(total_earning_kobo), 0) FROM dispatcher_earnings WHERE status IN ('PENDING', 'APPROVED')) as total_dispatcher_due_kobo,
          (SELECT COALESCE(SUM(total_earning_kobo), 0) FROM dispatcher_earnings WHERE status = 'PAID') as total_dispatcher_paid_kobo,
          (SELECT COALESCE(SUM(amount_kobo), 0) FROM refunds WHERE status = 'COMPLETED') as total_refunded_kobo,
          (SELECT COALESCE(SUM(platform_margin_kobo + delivery_fee_kobo), 0) FROM orders WHERE payment_status = 'PAID') as net_platform_revenue_kobo
      `),
    ]);

    const totals = {
      totalCustomerPaymentsKobo: Number(totalsRow?.total_customer_payments_kobo || 0),
      totalWalletFundingKobo: Number(totalsRow?.total_wallet_funding_kobo || 0),
      totalRetailerPayoutsDueKobo: Number(totalsRow?.total_retailer_payouts_due_kobo || 0),
      totalRetailerPayoutsPaidKobo: Number(totalsRow?.total_retailer_payouts_paid_kobo || 0),
      totalDispatcherDueKobo: Number(totalsRow?.total_dispatcher_due_kobo || 0),
      totalDispatcherPaidKobo: Number(totalsRow?.total_dispatcher_paid_kobo || 0),
      totalRefundedKobo: Number(totalsRow?.total_refunded_kobo || 0),
      netPlatformRevenueKobo: Number(totalsRow?.net_platform_revenue_kobo || 0),
    };

    res.json({
      totals,
      retailerSettlements,
      dispatcherEarnings,
      walletTransactions,
      gatewayTransactions,
      refunds,
      auditLogs,
    });
  })
);

router.patch(
  '/finance/settlements/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['PENDING', 'APPROVED', 'PAID', 'CANCELLED']),
      notes: z.string().max(400).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid settlement status.' });
      return;
    }
    const db = getDb();
    const id = Number(req.params.id);
    const existing = await db.get<{
      id: number;
      settlement_reference: string;
      agreed_retailer_payout_kobo: number;
      retailer_id: number;
    }>('SELECT * FROM retailer_settlements WHERE id = ?', id);
    if (!existing) {
      res.status(404).json({ error: 'Settlement record not found.' });
      return;
    }

    await db.run(
      `
      UPDATE retailer_settlements
      SET status = ?,
          notes = COALESCE(?, notes),
          paid_at = CASE WHEN ? = 'PAID' THEN datetime('now') ELSE paid_at END
      WHERE id = ?
    `,
      parsed.data.status,
      parsed.data.notes ?? null,
      parsed.data.status,
      id
    );

    await writeFinancialAuditLog({
      eventType: `RETAILER_SETTLEMENT_${parsed.data.status}`,
      actorUserId: Number(req.user!.id),
      actorRole: 'ADMIN',
      entityType: 'retailer_settlement',
      entityId: id,
      reference: existing.settlement_reference,
      amountKobo: Number(existing.agreed_retailer_payout_kobo),
      details: { notes: parsed.data.notes || '' },
    });

    res.json({ ok: true });
  })
);

router.patch(
  '/finance/dispatcher-earnings/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['PENDING', 'APPROVED', 'PAID', 'REVERSED']),
      adminBonusNaira: z.number().min(0).max(50000).optional(),
      notes: z.string().max(400).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid dispatcher earning update.' });
      return;
    }
    const db = getDb();
    const id = Number(req.params.id);
    const existing = await db.get<{
      id: number;
      dispatcher_id: number;
      base_amount_kobo: number;
      distance_bonus_kobo: number;
      admin_bonus_kobo: number;
      payout_reference: string;
      order_id: number;
    }>('SELECT * FROM dispatcher_earnings WHERE id = ?', id);
    if (!existing) {
      res.status(404).json({ error: 'Dispatcher earning record not found.' });
      return;
    }

    const bonusKobo =
      parsed.data.adminBonusNaira !== undefined
        ? Math.round(parsed.data.adminBonusNaira * 100)
        : Number(existing.admin_bonus_kobo);
    const newTotal = Number(existing.base_amount_kobo) + Number(existing.distance_bonus_kobo) + bonusKobo;

    await db.run(
      `
      UPDATE dispatcher_earnings
      SET status = ?,
          admin_bonus_kobo = ?,
          total_earning_kobo = ?,
          notes = COALESCE(?, notes),
          paid_at = CASE WHEN ? = 'PAID' THEN datetime('now') ELSE paid_at END
      WHERE id = ?
    `,
      parsed.data.status,
      bonusKobo,
      newTotal,
      parsed.data.notes ?? null,
      parsed.data.status,
      id
    );

    await writeFinancialAuditLog({
      eventType: `DISPATCHER_EARNING_${parsed.data.status}`,
      actorUserId: Number(req.user!.id),
      actorRole: 'ADMIN',
      entityType: 'dispatcher_earning',
      entityId: id,
      reference: existing.payout_reference,
      amountKobo: newTotal,
      details: { bonusKobo, notes: parsed.data.notes || '' },
    });

    if (parsed.data.status === 'PAID') {
      await createNotification({
        userId: Number(existing.dispatcher_id),
        roleScope: 'DISPATCHER',
        title: 'Dispatcher Settlement Paid',
        message: `Your earning of ${formatNairaServer(newTotal)} (Ref: ${existing.payout_reference}) has been settled by Operations.`,
        type: 'PAYMENT',
        relatedOrderId: Number(existing.order_id),
      });
    }

    res.json({ ok: true });
  })
);

router.post(
  '/finance/refunds',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      orderId: z.number().int().positive(),
      amountNaira: z.number().positive().optional(),
      destination: z.enum(['WALLET', 'ORIGINAL_METHOD']).default('WALLET'),
      reason: z.string().min(4).max(400),
      adminNotes: z.string().max(400).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid refund details.' });
      return;
    }

    try {
      const result = await executeAdminRefund({
        orderId: parsed.data.orderId,
        adminUserId: Number(req.user!.id),
        amountKobo: parsed.data.amountNaira ? Math.round(parsed.data.amountNaira * 100) : undefined,
        destination: parsed.data.destination,
        reason: parsed.data.reason.trim(),
        adminNotes: parsed.data.adminNotes?.trim(),
      });
      res.status(201).json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  })
);

// --- PROMOTIONS, COMPLAINTS, REVIEWS & PLATFORM SETTINGS ---
router.get(
  '/promotions',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const promotions = await db.all('SELECT * FROM promotions ORDER BY created_at DESC');
    res.json({ promotions });
  })
);

router.post(
  '/promotions',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      code: z.string().min(3).max(30),
      title: z.string().min(3).max(120),
      description: z.string().max(400).optional(),
      discountType: z.enum(['FIXED', 'PERCENT']),
      discountValue: z.number().positive(),
      minOrderNaira: z.number().min(0).default(0),
      maxDiscountNaira: z.number().positive().default(5000),
      usageLimit: z.number().int().min(1).default(500),
      validFrom: z.string(),
      validUntil: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid promotion.' });
      return;
    }
    const d = parsed.data;
    const db = getDb();
    try {
      const val = d.discountType === 'FIXED' ? Math.round(d.discountValue * 100) : Math.round(d.discountValue);
      const info = await db.run(
        `
        INSERT INTO promotions (code, title, description, discount_type, discount_value, min_order_kobo, max_discount_kobo, usage_limit, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        d.code.trim().toUpperCase(),
        d.title.trim(),
        d.description?.trim() || '',
        d.discountType,
        val,
        Math.round(d.minOrderNaira * 100),
        Math.round(d.maxDiscountNaira * 100),
        d.usageLimit,
        d.validFrom,
        d.validUntil
      );
      const promotion = await db.get('SELECT * FROM promotions WHERE id = ?', Number(info.lastInsertRowid));
      res.status(201).json({ promotion });
    } catch {
      res.status(409).json({ error: 'Promotion code already exists.' });
    }
  })
);

router.patch(
  '/promotions/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    await db.run('UPDATE promotions SET is_active = ? WHERE id = ?', req.body?.isActive ? 1 : 0, Number(req.params.id));
    res.json({ ok: true });
  })
);

router.get(
  '/complaints',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const complaints = await db.all(`
      SELECT c.*, u.full_name as customer_name, u.email as customer_email, u.phone as customer_phone,
             o.order_reference
      FROM complaints c
      JOIN users u ON u.id = c.customer_id
      LEFT JOIN orders o ON o.id = c.order_id
      ORDER BY CASE c.status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END, c.created_at DESC
    `);
    res.json({ complaints });
  })
);

router.patch(
  '/complaints/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED']),
      adminResponse: z.string().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid complaint update.' });
      return;
    }
    const db = getDb();
    const id = Number(req.params.id);
    const comp = await db.get<{ customer_id: number; ticket_number: string; order_id: number | null }>(
      'SELECT customer_id, ticket_number, order_id FROM complaints WHERE id = ?',
      id
    );
    if (!comp) {
      res.status(404).json({ error: 'Complaint not found.' });
      return;
    }
    await db.run(
      `
      UPDATE complaints
      SET status = ?, admin_response = COALESCE(?, admin_response),
          resolved_by_admin_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
      parsed.data.status,
      parsed.data.adminResponse ?? null,
      req.user!.id,
      id
    );

    await createNotification({
      userId: Number(comp.customer_id),
      roleScope: 'CUSTOMER',
      title: `Support Ticket ${comp.ticket_number} Updated`,
      message: `Status: ${parsed.data.status}. ${parsed.data.adminResponse || ''}`,
      type: 'INFO',
      relatedOrderId: comp.order_id ? Number(comp.order_id) : null,
    });

    res.json({ ok: true });
  })
);

router.get(
  '/reviews',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const reviews = await db.all(`
      SELECT rv.*, u.full_name as customer_name, r.business_name as retailer_name,
             d.full_name as dispatcher_name, o.order_reference
      FROM reviews rv
      JOIN users u ON u.id = rv.customer_id
      JOIN retailers r ON r.id = rv.retailer_id
      LEFT JOIN users d ON d.id = rv.dispatcher_id
      JOIN orders o ON o.id = rv.order_id
      ORDER BY rv.created_at DESC
    `);
    res.json({ reviews });
  })
);

router.patch(
  '/reviews/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    await db.run('UPDATE reviews SET is_visible = ? WHERE id = ?', req.body?.isVisible ? 1 : 0, Number(req.params.id));
    res.json({ ok: true });
  })
);

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getPlatformSettings() });
  })
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const entries = Object.entries(req.body || {});
    for (const [k, v] of entries) {
      if (['commercial_fees', 'cancellation_policy', 'homepage_cms'].includes(k)) {
        await db.run(
          `INSERT OR REPLACE INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))`,
          k,
          JSON.stringify(v)
        );
      }
    }
    res.json({ ok: true, settings: await getPlatformSettings() });
  })
);

export default router;
