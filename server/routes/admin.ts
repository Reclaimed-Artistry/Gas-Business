import { Router } from 'express';
import { z } from 'zod';
import { getDb, runInTransaction } from '../db/database.js';
import { hashPassword, requireAuth, requireRole } from '../middleware/auth.js';
import { assignDispatcherToOrder, rankDispatchersForOrder } from '../services/dispatch.js';
import {
  executeAdminRefund,
  formatNairaServer,
  generateReference,
  getPlatformSettings,
  writeFinancialAuditLog,
} from '../services/payment.js';
import { broadcastOrderUpdate, createNotification } from '../services/events.js';

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
router.get('/overview', (_req, res) => {
  const db = getDb();

  const kpis = {
    totalCustomers: (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'CUSTOMER'").get() as { c: number }).c,
    totalRetailers: (db.prepare('SELECT COUNT(*) as c FROM retailers').get() as { c: number }).c,
    activeRetailers: (
      db.prepare("SELECT COUNT(*) as c FROM retailers WHERE status = 'APPROVED_ACTIVE'").get() as { c: number }
    ).c,
    pendingRetailers: (
      db.prepare("SELECT COUNT(*) as c FROM retailers WHERE status = 'PENDING_APPROVAL'").get() as { c: number }
    ).c,
    totalDispatchers: (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'DISPATCHER'").get() as { c: number }).c,
    activeDispatchers: (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM dispatcher_profiles dp JOIN users u ON u.id = dp.user_id WHERE u.status = 'ACTIVE' AND dp.availability_status IN ('ONLINE', 'BUSY')"
        )
        .get() as { c: number }
    ).c,
    totalOrders: (db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c,
    awaitingAssignment: (
      db
        .prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'AWAITING_DISPATCHER_ASSIGNMENT'")
        .get() as { c: number }
    ).c,
    activeDeliveries: (
      db
        .prepare(
          "SELECT COUNT(*) as c FROM orders WHERE status IN ('ASSIGNED_TO_DISPATCHER', 'ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT')"
        )
        .get() as { c: number }
    ).c,
    completedDeliveries: (
      db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERED'").get() as { c: number }
    ).c,
    failedDeliveries: (
      db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERY_FAILED'").get() as { c: number }
    ).c,
    openComplaints: (
      db.prepare("SELECT COUNT(*) as c FROM complaints WHERE status IN ('OPEN', 'IN_REVIEW')").get() as { c: number }
    ).c,
    grossOrderVolumeKobo: (
      db
        .prepare("SELECT COALESCE(SUM(total_amount_kobo), 0) as s FROM orders WHERE payment_status = 'PAID'")
        .get() as { s: number }
    ).s,
    platformRevenueKobo: (
      db
        .prepare("SELECT COALESCE(SUM(platform_margin_kobo + delivery_fee_kobo), 0) as s FROM orders WHERE payment_status = 'PAID'")
        .get() as { s: number }
    ).s,
    pendingRetailerSettlementsKobo: (
      db
        .prepare("SELECT COALESCE(SUM(agreed_retailer_payout_kobo), 0) as s FROM retailer_settlements WHERE status IN ('PENDING', 'APPROVED')")
        .get() as { s: number }
    ).s,
    pendingDispatcherPayoutsKobo: (
      db
        .prepare("SELECT COALESCE(SUM(total_earning_kobo), 0) as s FROM dispatcher_earnings WHERE status IN ('PENDING', 'APPROVED')")
        .get() as { s: number }
    ).s,
    totalCustomerWalletLiabilityKobo: (
      db.prepare('SELECT COALESCE(SUM(balance_kobo), 0) as s FROM wallets').get() as { s: number }
    ).s,
  };

  const ordersByStatus = db
    .prepare('SELECT status, COUNT(*) as count FROM orders GROUP BY status ORDER BY count DESC')
    .all();

  const coverageByState = db
    .prepare(`
      SELECT state, city,
             COUNT(*) as total_retailers,
             SUM(CASE WHEN status = 'APPROVED_ACTIVE' THEN 1 ELSE 0 END) as active_retailers,
             AVG(max_delivery_radius_km) as avg_radius_km
      FROM retailers
      GROUP BY state, city
      ORDER BY total_retailers DESC
    `)
    .all();

  const retailerRevenueRank = db
    .prepare(`
      SELECT r.id, r.business_name, r.neighbourhood, r.city,
             COUNT(o.id) as orders_count,
             COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.total_amount_kobo ELSE 0 END), 0) as gmv_kobo,
             COALESCE(SUM(CASE WHEN o.payment_status = 'PAID' THEN o.platform_margin_kobo ELSE 0 END), 0) as margin_kobo
      FROM retailers r
      LEFT JOIN orders o ON o.retailer_id = r.id
      GROUP BY r.id
      ORDER BY gmv_kobo DESC
      LIMIT 8
    `)
    .all();

  const recentOrders = db
    .prepare(`
      SELECT o.id, o.order_reference, o.status, o.payment_method, o.payment_status, o.total_amount_kobo,
             o.delivery_neighbourhood, o.delivery_city, o.created_at,
             c.full_name as customer_name, r.business_name as retailer_name, d.full_name as dispatcher_name
      FROM orders o
      JOIN users c ON c.id = o.customer_id
      JOIN retailers r ON r.id = o.retailer_id
      LEFT JOIN users d ON d.id = o.dispatcher_id
      ORDER BY o.created_at DESC
      LIMIT 10
    `)
    .all();

  res.json({ kpis, ordersByStatus, coverageByState, retailerRevenueRank, recentOrders });
});

// --- RETAILER MANAGEMENT (EXCLUSIVE TO ADMIN — NO RETAILER ACCOUNTS) ---
router.get('/retailers', (_req, res) => {
  const db = getDb();
  const retailers = db
    .prepare(`
      SELECT r.*,
             (SELECT COUNT(*) FROM retailer_products rp WHERE rp.retailer_id = r.id AND rp.is_available = 1) as active_products_count,
             (SELECT COUNT(*) FROM orders o WHERE o.retailer_id = r.id) as total_orders
      FROM retailers r
      ORDER BY r.created_at DESC
    `)
    .all();
  res.json({ retailers });
});

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

router.post('/retailers', (req, res) => {
  const parsed = retailerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid retailer data.' });
    return;
  }
  const d = parsed.data;
  const db = getDb();
  const slug = slugify(d.businessName);
  const info = db
    .prepare(`
      INSERT INTO retailers (
        business_name, slug, contact_person, phone, email, address, neighbourhood, city, state,
        lat, lng, logo_url, cover_image_url, description, operating_hours_json, is_open_now,
        max_delivery_radius_km, coverage_areas_json, base_delivery_fee_kobo, per_km_delivery_fee_kobo,
        estimated_prep_mins, status, featured, created_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
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
      d.coverImageUrl?.trim() || '/images/retailer-depot.jpg',
      d.description?.trim() || '',
      JSON.stringify(d.operatingHours || { mon_fri: '07:00 - 20:00', sat: '08:00 - 19:00', sun: '09:00 - 17:00' }),
      d.isOpenNow === false ? 0 : 1,
      d.maxDeliveryRadiusKm,
      JSON.stringify(d.coverageAreas.map((a) => a.trim()).filter(Boolean)),
      Math.round(d.baseDeliveryFeeNaira * 100),
      Math.round(d.perKmDeliveryFeeNaira * 100),
      d.estimatedPrepMins ?? 15,
      d.status || 'APPROVED_ACTIVE',
      d.featured ? 1 : 0,
      req.user!.id
    );

  const retailer = db.prepare('SELECT * FROM retailers WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ retailer });
});

router.patch('/retailers/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM retailers WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Retailer not found.' });
    return;
  }

  const b = req.body || {};
  db.prepare(`
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
  `).run(
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

  const retailer = db.prepare('SELECT * FROM retailers WHERE id = ?').get(id);
  res.json({ retailer });
});

router.delete('/retailers/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const orderCnt = (db.prepare('SELECT COUNT(*) as c FROM orders WHERE retailer_id = ?').get(id) as { c: number }).c;
  if (orderCnt > 0) {
    // Preserve financial audit trail by suspending/deactivating instead of hard-deleting retailers with historical orders
    db.prepare("UPDATE retailers SET status = 'SUSPENDED', is_open_now = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    res.json({ ok: true, softDeactivated: true, message: 'Retailer has historical orders and was suspended to preserve audit records.' });
    return;
  }
  db.prepare('DELETE FROM retailers WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- PRODUCTS & INDEPENDENT PER-RETAILER PRICING ---
router.get('/products', (_req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM product_categories ORDER BY sort_order ASC').all();
  const products = db
    .prepare(`
      SELECT p.*, pc.name as category_name, pc.type as category_type,
             (SELECT COUNT(*) FROM retailer_products rp WHERE rp.product_id = p.id) as assigned_retailers_count
      FROM products p
      JOIN product_categories pc ON pc.id = p.category_id
      ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
    `)
    .all();
  res.json({ categories, products });
});

router.post('/categories', (req, res) => {
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
  const info = db
    .prepare('INSERT INTO product_categories (name, slug, type, description) VALUES (?, ?, ?, ?)')
    .run(parsed.data.name.trim(), slugify(parsed.data.name), parsed.data.type, parsed.data.description?.trim() || '');
  res.status(201).json({ category: db.prepare('SELECT * FROM product_categories WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

router.post('/products', (req, res) => {
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
  const info = db
    .prepare(`
      INSERT INTO products (category_id, name, slug, size_kg, unit_label, description, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      d.categoryId,
      d.name.trim(),
      slugify(d.name),
      d.sizeKg ?? null,
      d.unitLabel.trim(),
      d.description?.trim() || '',
      d.imageUrl?.trim() || '/images/product-refill-12kg.jpg'
    );
  res.status(201).json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

router.patch('/products/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const b = req.body || {};
  db.prepare(`
    UPDATE products
    SET name = COALESCE(?, name),
        unit_label = COALESCE(?, unit_label),
        description = COALESCE(?, description),
        image_url = COALESCE(?, image_url),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    b.name ?? null,
    b.unitLabel ?? null,
    b.description ?? null,
    b.imageUrl ?? null,
    b.isActive !== undefined ? (b.isActive ? 1 : 0) : null,
    id
  );
  res.json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(id) });
});

// Get independent pricing & inventory for a specific retailer
router.get('/retailers/:id/products', (req, res) => {
  const db = getDb();
  const items = db
    .prepare(`
      SELECT rp.*, p.name as product_name, p.size_kg, p.unit_label, p.image_url, pc.name as category_name, pc.type as category_type
      FROM retailer_products rp
      JOIN products p ON p.id = rp.product_id
      JOIN product_categories pc ON pc.id = p.category_id
      WHERE rp.retailer_id = ?
      ORDER BY pc.sort_order ASC, COALESCE(p.size_kg, 999) ASC
    `)
    .all(Number(req.params.id));
  res.json({ items });
});

// Assign / update independent price, supply cost, stock, & availability for a retailer
router.put('/retailers/:id/products', (req, res) => {
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

  db.prepare(`
    INSERT INTO retailer_products (retailer_id, product_id, selling_price_kobo, retailer_supply_cost_kobo, stock_quantity, is_available, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(retailer_id, product_id) DO UPDATE SET
      selling_price_kobo = excluded.selling_price_kobo,
      retailer_supply_cost_kobo = excluded.retailer_supply_cost_kobo,
      stock_quantity = excluded.stock_quantity,
      is_available = excluded.is_available,
      updated_at = datetime('now')
  `).run(retailerId, d.productId, sellKobo, supplyKobo, d.stockQuantity, d.isAvailable ? 1 : 0);

  res.json({ ok: true });
});

router.delete('/retailers/:id/products/:productId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM retailer_products WHERE retailer_id = ? AND product_id = ?').run(
    Number(req.params.id),
    Number(req.params.productId)
  );
  res.json({ ok: true });
});

// --- CUSTOMER MANAGEMENT ---
router.get('/customers', (_req, res) => {
  const db = getDb();
  const customers = db
    .prepare(`
      SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
             COALESCE(w.balance_kobo, 0) as wallet_balance_kobo,
             (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) as orders_count,
             (SELECT COALESCE(SUM(o.total_amount_kobo), 0) FROM orders o WHERE o.customer_id = u.id AND o.payment_status = 'PAID') as total_spent_kobo
      FROM users u
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE u.role = 'CUSTOMER'
      ORDER BY u.created_at DESC
    `)
    .all();
  res.json({ customers });
});

router.post('/customers', (req, res) => {
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
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(parsed.data.email.trim().toLowerCase())) {
    res.status(409).json({ error: 'Email already registered.' });
    return;
  }
  const created = runInTransaction((tdb) => {
    const info = tdb
      .prepare("INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('CUSTOMER', ?, ?, ?, ?, 'ACTIVE')")
      .run(
        parsed.data.fullName.trim(),
        parsed.data.email.trim().toLowerCase(),
        parsed.data.phone.trim(),
        hashPassword(parsed.data.password)
      );
    const id = Number(info.lastInsertRowid);
    tdb.prepare('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, 0)').run(id);
    return tdb.prepare('SELECT id, full_name, email, phone, status, created_at FROM users WHERE id = ?').get(id);
  });
  res.status(201).json({ customer: created });
});

router.patch('/customers/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const b = req.body || {};
  db.prepare(`
    UPDATE users
    SET full_name = COALESCE(?, full_name),
        phone = COALESCE(?, phone),
        status = COALESCE(?, status),
        updated_at = datetime('now')
    WHERE id = ? AND role = 'CUSTOMER'
  `).run(b.fullName ?? null, b.phone ?? null, b.status ?? null, id);
  res.json({ ok: true });
});

// --- DISPATCHER MANAGEMENT (EXCLUSIVE CREATION BY ADMIN) ---
router.get('/dispatchers', (_req, res) => {
  const db = getDb();
  const dispatchers = db
    .prepare(`
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
    `)
    .all();
  res.json({ dispatchers });
});

router.post('/dispatchers', (req, res) => {
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
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(d.email.trim().toLowerCase())) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const created = runInTransaction((tdb) => {
    const info = tdb
      .prepare("INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('DISPATCHER', ?, ?, ?, ?, 'ACTIVE')")
      .run(d.fullName.trim(), d.email.trim().toLowerCase(), d.phone.trim(), hashPassword(d.password));
    const userId = Number(info.lastInsertRowid);
    tdb
      .prepare(`
        INSERT INTO dispatcher_profiles (
          user_id, vehicle_type, plate_number, license_number, zone, availability_status,
          current_lat, current_lng, compensation_model, base_rate_kobo, per_km_rate_kobo
        ) VALUES (?, ?, ?, ?, ?, 'ONLINE', ?, ?, ?, ?, ?)
      `)
      .run(
        userId,
        d.vehicleType.trim(),
        d.plateNumber.trim().toUpperCase(),
        d.licenseNumber.trim().toUpperCase(),
        d.zone.trim(),
        d.lat ?? 6.4541,
        d.lng ?? 3.3947,
        d.compensationModel || 'FIXED_PLUS_DISTANCE',
        Math.round((d.baseRateNaira ?? 800) * 100),
        Math.round((d.perKmRateNaira ?? 80) * 100)
      );
    return userId;
  });

  res.status(201).json({ ok: true, dispatcherId: created });
});

router.patch('/dispatchers/:id', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  runInTransaction((db) => {
    db.prepare(`
      UPDATE users
      SET full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          status = COALESCE(?, status),
          updated_at = datetime('now')
      WHERE id = ? AND role = 'DISPATCHER'
    `).run(b.fullName ?? null, b.phone ?? null, b.status ?? null, id);

    db.prepare(`
      UPDATE dispatcher_profiles
      SET vehicle_type = COALESCE(?, vehicle_type),
          plate_number = COALESCE(?, plate_number),
          zone = COALESCE(?, zone),
          availability_status = COALESCE(?, availability_status),
          compensation_model = COALESCE(?, compensation_model),
          base_rate_kobo = COALESCE(?, base_rate_kobo),
          per_km_rate_kobo = COALESCE(?, per_km_rate_kobo)
      WHERE user_id = ?
    `).run(
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
});

// --- ORDER MANAGEMENT & DISPATCH ASSIGNMENT ---
router.get('/orders', (req, res) => {
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
  const orders = (statusFilter ? db.prepare(sql).all(statusFilter) : db.prepare(sql).all()) as Record<string, unknown>[];

  const orderIds = orders.map((o) => Number(o.id));
  const itemsByOrder = new Map<number, unknown[]>();
  const histByOrder = new Map<number, unknown[]>();
  if (orderIds.length > 0) {
    const ph = orderIds.map(() => '?').join(',');
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${ph})`).all(...orderIds) as { order_id: number }[];
    for (const it of items) {
      const arr = itemsByOrder.get(it.order_id) || [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }
    const hist = db
      .prepare(`SELECT * FROM order_status_history WHERE order_id IN (${ph}) ORDER BY created_at ASC`)
      .all(...orderIds) as { order_id: number }[];
    for (const h of hist) {
      const arr = histByOrder.get(h.order_id) || [];
      arr.push(h);
      histByOrder.set(h.order_id, arr);
    }
  }

  res.json({
    orders: orders.map((o) => ({
      ...o,
      items: itemsByOrder.get(Number(o.id)) || [],
      timeline: histByOrder.get(Number(o.id)) || [],
    })),
  });
});

// Automatic Dispatcher Assignment Recommendations
router.get('/orders/:id/recommendations', (req, res) => {
  try {
    const candidates = rankDispatchersForOrder(Number(req.params.id));
    res.json({ candidates });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// Assign or Reassign Dispatcher (Supports both Manual selection & Auto-Assign!)
router.post('/orders/:id/assign', (req, res) => {
  const orderId = Number(req.params.id);
  const autoAssign = Boolean(req.body?.autoAssign);
  let dispatcherId = req.body?.dispatcherId ? Number(req.body.dispatcherId) : 0;

  try {
    if (autoAssign) {
      const ranked = rankDispatchersForOrder(orderId);
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

    const result = assignDispatcherToOrder({
      orderId,
      dispatcherId,
      adminUserId: req.user!.id,
      isAutoAssigned: autoAssign,
      note: req.body?.note,
    });
    res.json({ ok: true, ...result, autoAssigned: autoAssign });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/orders/:id/cancel', (req, res) => {
  const orderId = Number(req.params.id);
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Cancelled by Operations Administrator';
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
    | { id: number; order_reference: string; customer_id: number; dispatcher_id: number | null; status: string; payment_status: string }
    | undefined;
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (['DELIVERED', 'REFUNDED'].includes(order.status)) {
    res.status(400).json({ error: 'Delivered or already refunded orders cannot be cancelled.' });
    return;
  }

  runInTransaction((tdb) => {
    tdb
      .prepare(`UPDATE orders SET status = 'CANCELLED', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(order.id);
    tdb
      .prepare(`
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
        VALUES (?, ?, 'CANCELLED', ?, 'ADMIN', ?)
      `)
      .run(order.id, order.status, req.user!.id, reason);
  });

  createNotification({
    userId: order.customer_id,
    roleScope: 'CUSTOMER',
    title: 'Order Cancelled by Operations',
    message: `Order ${order.order_reference} has been cancelled. Reason: ${reason}.`,
    type: 'ORDER',
    relatedOrderId: order.id,
  });
  if (order.dispatcher_id) {
    createNotification({
      userId: order.dispatcher_id,
      roleScope: 'DISPATCHER',
      title: 'Delivery Cancelled',
      message: `Order ${order.order_reference} was cancelled by Operations Admin.`,
      type: 'DISPATCH',
      relatedOrderId: order.id,
    });
  }
  broadcastOrderUpdate(order.id, order.customer_id, order.dispatcher_id, 'CANCELLED');
  res.json({ ok: true });
});

// --- FINANCE, SETTLEMENTS, COMPENSATION, REFUNDS & AUDIT LOGS ---
router.get('/finance/summary', (_req, res) => {
  const db = getDb();

  const retailerSettlements = db
    .prepare(`
      SELECT rs.*, r.business_name as retailer_name, r.phone as retailer_phone,
             o.order_reference, o.status as order_status, o.created_at as order_date
      FROM retailer_settlements rs
      JOIN retailers r ON r.id = rs.retailer_id
      JOIN orders o ON o.id = rs.order_id
      ORDER BY rs.created_at DESC
    `)
    .all();

  const dispatcherEarnings = db
    .prepare(`
      SELECT de.*, u.full_name as dispatcher_name, u.phone as dispatcher_phone,
             o.order_reference, o.distance_km, o.delivered_at
      FROM dispatcher_earnings de
      JOIN users u ON u.id = de.dispatcher_id
      JOIN orders o ON o.id = de.order_id
      ORDER BY de.created_at DESC
    `)
    .all();

  const walletTransactions = db
    .prepare(`
      SELECT wt.*, u.full_name as customer_name, u.email as customer_email
      FROM wallet_transactions wt
      JOIN users u ON u.id = wt.user_id
      ORDER BY wt.created_at DESC
      LIMIT 100
    `)
    .all();

  const gatewayTransactions = db
    .prepare(`
      SELECT gt.*, u.full_name as customer_name, u.email as customer_email
      FROM gateway_transactions gt
      JOIN users u ON u.id = gt.user_id
      ORDER BY gt.created_at DESC
      LIMIT 100
    `)
    .all();

  const refunds = db
    .prepare(`
      SELECT rf.*, o.order_reference, u.full_name as customer_name, u.email as customer_email
      FROM refunds rf
      JOIN orders o ON o.id = rf.order_id
      JOIN users u ON u.id = rf.customer_id
      ORDER BY rf.created_at DESC
    `)
    .all();

  const auditLogs = db
    .prepare(`
      SELECT fal.*, u.full_name as actor_name
      FROM financial_audit_logs fal
      LEFT JOIN users u ON u.id = fal.actor_user_id
      ORDER BY fal.created_at DESC
      LIMIT 120
    `)
    .all();

  const totals = {
    totalCustomerPaymentsKobo: (
      db.prepare("SELECT COALESCE(SUM(total_amount_kobo), 0) as s FROM orders WHERE payment_status = 'PAID'").get() as { s: number }
    ).s,
    totalWalletFundingKobo: (
      db.prepare("SELECT COALESCE(SUM(amount_kobo), 0) as s FROM wallet_transactions WHERE type = 'FUNDING' AND status = 'SUCCESS'").get() as { s: number }
    ).s,
    totalRetailerPayoutsDueKobo: (
      db.prepare("SELECT COALESCE(SUM(agreed_retailer_payout_kobo), 0) as s FROM retailer_settlements WHERE status IN ('PENDING', 'APPROVED')").get() as { s: number }
    ).s,
    totalRetailerPayoutsPaidKobo: (
      db.prepare("SELECT COALESCE(SUM(agreed_retailer_payout_kobo), 0) as s FROM retailer_settlements WHERE status = 'PAID'").get() as { s: number }
    ).s,
    totalDispatcherDueKobo: (
      db.prepare("SELECT COALESCE(SUM(total_earning_kobo), 0) as s FROM dispatcher_earnings WHERE status IN ('PENDING', 'APPROVED')").get() as { s: number }
    ).s,
    totalDispatcherPaidKobo: (
      db.prepare("SELECT COALESCE(SUM(total_earning_kobo), 0) as s FROM dispatcher_earnings WHERE status = 'PAID'").get() as { s: number }
    ).s,
    totalRefundedKobo: (
      db.prepare("SELECT COALESCE(SUM(amount_kobo), 0) as s FROM refunds WHERE status = 'COMPLETED'").get() as { s: number }
    ).s,
    netPlatformRevenueKobo: (
      db.prepare("SELECT COALESCE(SUM(platform_margin_kobo + delivery_fee_kobo), 0) as s FROM orders WHERE payment_status = 'PAID'").get() as { s: number }
    ).s,
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
});

router.patch('/finance/settlements/:id', (req, res) => {
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
  const existing = db.prepare('SELECT * FROM retailer_settlements WHERE id = ?').get(id) as
    | { id: number; settlement_reference: string; agreed_retailer_payout_kobo: number; retailer_id: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Settlement record not found.' });
    return;
  }

  db.prepare(`
    UPDATE retailer_settlements
    SET status = ?,
        notes = COALESCE(?, notes),
        paid_at = CASE WHEN ? = 'PAID' THEN datetime('now') ELSE paid_at END
    WHERE id = ?
  `).run(parsed.data.status, parsed.data.notes ?? null, parsed.data.status, id);

  writeFinancialAuditLog({
    eventType: `RETAILER_SETTLEMENT_${parsed.data.status}`,
    actorUserId: req.user!.id,
    actorRole: 'ADMIN',
    entityType: 'retailer_settlement',
    entityId: id,
    reference: existing.settlement_reference,
    amountKobo: existing.agreed_retailer_payout_kobo,
    details: { notes: parsed.data.notes || '' },
  });

  res.json({ ok: true });
});

router.patch('/finance/dispatcher-earnings/:id', (req, res) => {
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
  const existing = db.prepare('SELECT * FROM dispatcher_earnings WHERE id = ?').get(id) as
    | {
        id: number;
        dispatcher_id: number;
        base_amount_kobo: number;
        distance_bonus_kobo: number;
        admin_bonus_kobo: number;
        payout_reference: string;
        order_id: number;
      }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Dispatcher earning record not found.' });
    return;
  }

  const bonusKobo =
    parsed.data.adminBonusNaira !== undefined ? Math.round(parsed.data.adminBonusNaira * 100) : existing.admin_bonus_kobo;
  const newTotal = existing.base_amount_kobo + existing.distance_bonus_kobo + bonusKobo;

  db.prepare(`
    UPDATE dispatcher_earnings
    SET status = ?,
        admin_bonus_kobo = ?,
        total_earning_kobo = ?,
        notes = COALESCE(?, notes),
        paid_at = CASE WHEN ? = 'PAID' THEN datetime('now') ELSE paid_at END
    WHERE id = ?
  `).run(parsed.data.status, bonusKobo, newTotal, parsed.data.notes ?? null, parsed.data.status, id);

  writeFinancialAuditLog({
    eventType: `DISPATCHER_EARNING_${parsed.data.status}`,
    actorUserId: req.user!.id,
    actorRole: 'ADMIN',
    entityType: 'dispatcher_earning',
    entityId: id,
    reference: existing.payout_reference,
    amountKobo: newTotal,
    details: { bonusKobo, notes: parsed.data.notes || '' },
  });

  if (parsed.data.status === 'PAID') {
    createNotification({
      userId: existing.dispatcher_id,
      roleScope: 'DISPATCHER',
      title: 'Dispatcher Settlement Paid',
      message: `Your earning of ${formatNairaServer(newTotal)} (Ref: ${existing.payout_reference}) has been settled by Operations.`,
      type: 'PAYMENT',
      relatedOrderId: existing.order_id,
    });
  }

  res.json({ ok: true });
});

router.post('/finance/refunds', (req, res) => {
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
    const result = executeAdminRefund({
      orderId: parsed.data.orderId,
      adminUserId: req.user!.id,
      amountKobo: parsed.data.amountNaira ? Math.round(parsed.data.amountNaira * 100) : undefined,
      destination: parsed.data.destination,
      reason: parsed.data.reason.trim(),
      adminNotes: parsed.data.adminNotes?.trim(),
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- PROMOTIONS, COMPLAINTS, REVIEWS & PLATFORM SETTINGS ---
router.get('/promotions', (_req, res) => {
  const db = getDb();
  res.json({ promotions: db.prepare('SELECT * FROM promotions ORDER BY created_at DESC').all() });
});

router.post('/promotions', (req, res) => {
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
    const info = db
      .prepare(`
        INSERT INTO promotions (code, title, description, discount_type, discount_value, min_order_kobo, max_discount_kobo, usage_limit, valid_from, valid_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
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
    res.status(201).json({ promotion: db.prepare('SELECT * FROM promotions WHERE id = ?').get(Number(info.lastInsertRowid)) });
  } catch {
    res.status(409).json({ error: 'Promotion code already exists.' });
  }
});

router.patch('/promotions/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE promotions SET is_active = ? WHERE id = ?').run(req.body?.isActive ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

router.get('/complaints', (_req, res) => {
  const db = getDb();
  const complaints = db
    .prepare(`
      SELECT c.*, u.full_name as customer_name, u.email as customer_email, u.phone as customer_phone,
             o.order_reference
      FROM complaints c
      JOIN users u ON u.id = c.customer_id
      LEFT JOIN orders o ON o.id = c.order_id
      ORDER BY CASE c.status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END, c.created_at DESC
    `)
    .all();
  res.json({ complaints });
});

router.patch('/complaints/:id', (req, res) => {
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
  const comp = db.prepare('SELECT customer_id, ticket_number, order_id FROM complaints WHERE id = ?').get(id) as
    | { customer_id: number; ticket_number: string; order_id: number | null }
    | undefined;
  if (!comp) {
    res.status(404).json({ error: 'Complaint not found.' });
    return;
  }
  db.prepare(`
    UPDATE complaints
    SET status = ?, admin_response = COALESCE(?, admin_response),
        resolved_by_admin_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(parsed.data.status, parsed.data.adminResponse ?? null, req.user!.id, id);

  createNotification({
    userId: comp.customer_id,
    roleScope: 'CUSTOMER',
    title: `Support Ticket ${comp.ticket_number} Updated`,
    message: `Status: ${parsed.data.status}. ${parsed.data.adminResponse || ''}`,
    type: 'INFO',
    relatedOrderId: comp.order_id,
  });

  res.json({ ok: true });
});

router.get('/reviews', (_req, res) => {
  const db = getDb();
  const reviews = db
    .prepare(`
      SELECT rv.*, u.full_name as customer_name, r.business_name as retailer_name,
             d.full_name as dispatcher_name, o.order_reference
      FROM reviews rv
      JOIN users u ON u.id = rv.customer_id
      JOIN retailers r ON r.id = rv.retailer_id
      LEFT JOIN users d ON d.id = rv.dispatcher_id
      JOIN orders o ON o.id = rv.order_id
      ORDER BY rv.created_at DESC
    `)
    .all();
  res.json({ reviews });
});

router.patch('/reviews/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE reviews SET is_visible = ? WHERE id = ?').run(req.body?.isVisible ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

router.get('/settings', (_req, res) => {
  res.json({ settings: getPlatformSettings() });
});

router.put('/settings', (req, res) => {
  const db = getDb();
  const entries = Object.entries(req.body || {});
  const stmt = db.prepare(`INSERT OR REPLACE INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))`);
  for (const [k, v] of entries) {
    if (['commercial_fees', 'cancellation_policy', 'homepage_cms'].includes(k)) {
      stmt.run(k, JSON.stringify(v));
    }
  }
  res.json({ ok: true, settings: getPlatformSettings() });
});

export default router;
