import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb, runInTransaction } from '../db/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { checkRetailerCoverage } from '../services/geo.js';
import { calculateServiceFeeKobo } from './public.js';
import {
  ensureWalletForUser,
  generateReference,
  initializeGatewayTransaction,
  payOrderWithWallet,
} from '../services/payment.js';
import { broadcastOrderUpdate, createNotification, notifyAllAdmins } from '../services/events.js';

const router = Router();
router.use(requireAuth, requireRole('CUSTOMER'));

// --- SAVED DELIVERY ADDRESSES ---
router.get('/addresses', (req, res) => {
  const db = getDb();
  const addresses = db
    .prepare('SELECT * FROM customer_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
    .all(req.user!.id);
  res.json({ addresses });
});

router.post('/addresses', (req, res) => {
  const schema = z.object({
    label: z.string().min(1).max(60),
    addressLine: z.string().min(4).max(240),
    neighbourhood: z.string().min(2).max(100),
    city: z.string().min(2).max(80),
    state: z.string().min(2).max(80),
    lat: z.number(),
    lng: z.number(),
    deliveryInstructions: z.string().max(300).optional(),
    isDefault: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid address.' });
    return;
  }

  const d = parsed.data;
  const created = runInTransaction((db) => {
    if (d.isDefault) {
      db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE user_id = ?').run(req.user!.id);
    }
    const info = db
      .prepare(`
        INSERT INTO customer_addresses (user_id, label, address_line, neighbourhood, city, state, lat, lng, delivery_instructions, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        req.user!.id,
        d.label.trim(),
        d.addressLine.trim(),
        d.neighbourhood.trim(),
        d.city.trim(),
        d.state.trim(),
        d.lat,
        d.lng,
        d.deliveryInstructions?.trim() || '',
        d.isDefault ? 1 : 0
      );
    return db.prepare('SELECT * FROM customer_addresses WHERE id = ?').get(Number(info.lastInsertRowid));
  });

  res.status(201).json({ address: created });
});

router.delete('/addresses/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM customer_addresses WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user!.id);
  res.json({ ok: true });
});

// --- FAVOURITE RETAILERS ---
router.get('/favourites', (req, res) => {
  const db = getDb();
  const favourites = db
    .prepare(`
      SELECT r.id, r.business_name, r.slug, r.address, r.neighbourhood, r.city, r.state,
             r.rating_avg, r.review_count, r.is_open_now, r.cover_image_url, r.max_delivery_radius_km
      FROM favourite_retailers fr
      JOIN retailers r ON r.id = fr.retailer_id
      WHERE fr.user_id = ? AND r.status = 'APPROVED_ACTIVE'
      ORDER BY fr.created_at DESC
    `)
    .all(req.user!.id);
  res.json({ favourites });
});

router.post('/favourites/:retailerId', (req, res) => {
  const db = getDb();
  const retailerId = Number(req.params.retailerId);
  const exists = db
    .prepare("SELECT id FROM retailers WHERE id = ? AND status = 'APPROVED_ACTIVE'")
    .get(retailerId);
  if (!exists) {
    res.status(404).json({ error: 'Retailer not found.' });
    return;
  }
  db.prepare('INSERT OR IGNORE INTO favourite_retailers (user_id, retailer_id) VALUES (?, ?)').run(
    req.user!.id,
    retailerId
  );
  res.json({ ok: true, saved: true });
});

router.delete('/favourites/:retailerId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM favourite_retailers WHERE user_id = ? AND retailer_id = ?').run(
    req.user!.id,
    Number(req.params.retailerId)
  );
  res.json({ ok: true, saved: false });
});

// --- DIGITAL WALLET ---
router.get('/wallet', (req, res) => {
  const db = getDb();
  const wallet = ensureWalletForUser(req.user!.id);
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : 'ALL';

  let transactions;
  if (['SUCCESS', 'PENDING', 'FAILED'].includes(statusFilter)) {
    transactions = db
      .prepare('SELECT * FROM wallet_transactions WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user!.id, statusFilter);
  } else {
    transactions = db
      .prepare('SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user!.id);
  }

  const pendingGateway = db
    .prepare(
      "SELECT * FROM gateway_transactions WHERE user_id = ? AND purpose = 'WALLET_FUNDING' AND status IN ('INITIALIZED', 'PENDING') ORDER BY created_at DESC LIMIT 10"
    )
    .all(req.user!.id);

  res.json({
    wallet: {
      id: wallet.id,
      balanceKobo: wallet.balance_kobo,
    },
    transactions,
    pendingGateway,
  });
});

// --- ORDERS & CHECKOUT ---
router.get('/orders', (req, res) => {
  const db = getDb();
  const orders = db
    .prepare(`
      SELECT o.*,
             r.business_name as retailer_name, r.address as retailer_address, r.phone as retailer_phone,
             r.lat as retailer_lat, r.lng as retailer_lng,
             u.full_name as dispatcher_name, u.phone as dispatcher_phone,
             dp.vehicle_type as dispatcher_vehicle, dp.plate_number as dispatcher_plate,
             dp.rating_avg as dispatcher_rating,
             dp.current_lat as dispatcher_lat, dp.current_lng as dispatcher_lng,
             dp.location_tracking_enabled as dispatcher_tracking_enabled,
             dp.location_updated_at as dispatcher_location_updated_at,
             (SELECT COUNT(*) FROM reviews rv WHERE rv.order_id = o.id) as has_review
      FROM orders o
      JOIN retailers r ON r.id = o.retailer_id
      LEFT JOIN users u ON u.id = o.dispatcher_id
      LEFT JOIN dispatcher_profiles dp ON dp.user_id = o.dispatcher_id
      WHERE o.customer_id = ?
      ORDER BY o.created_at DESC
    `)
    .all(req.user!.id) as Record<string, unknown>[];

  const orderIds = orders.map((o) => Number(o.id));
  const itemsByOrder = new Map<number, unknown[]>();
  const historyByOrder = new Map<number, unknown[]>();

  if (orderIds.length > 0) {
    const ph = orderIds.map(() => '?').join(',');
    const items = db
      .prepare(
        `SELECT id, order_id, product_id, product_name, size_kg, quantity, unit_price_kobo, line_total_kobo FROM order_items WHERE order_id IN (${ph})`
      )
      .all(...orderIds) as { order_id: number }[];
    for (const it of items) {
      const arr = itemsByOrder.get(it.order_id) || [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }

    const hist = db
      .prepare(`SELECT * FROM order_status_history WHERE order_id IN (${ph}) ORDER BY created_at ASC`)
      .all(...orderIds) as { order_id: number }[];
    for (const h of hist) {
      const arr = historyByOrder.get(h.order_id) || [];
      arr.push(h);
      historyByOrder.set(h.order_id, arr);
    }
  }

  const activeStatuses = new Set([
    'ACCEPTED_BY_DISPATCHER',
    'AWAITING_COLLECTION',
    'COLLECTED_FROM_RETAILER',
    'IN_TRANSIT',
  ]);

  const formatted = orders.map((o) => {
    const isTrackingActive = activeStatuses.has(String(o.status)) && Number(o.dispatcher_tracking_enabled) === 1;
    // Strip admin-only fields & hide dispatcher coordinates outside active delivery tracking
    const {
      retailer_supply_total_kobo: _s,
      platform_margin_kobo: _m,
      ...safeOrder
    } = o;
    return {
      ...safeOrder,
      liveTrackingActive: isTrackingActive,
      dispatcher_lat: isTrackingActive ? o.dispatcher_lat : null,
      dispatcher_lng: isTrackingActive ? o.dispatcher_lng : null,
      items: itemsByOrder.get(Number(o.id)) || [],
      timeline: historyByOrder.get(Number(o.id)) || [],
    };
  });

  res.json({ orders: formatted });
});

router.get('/orders/:id', (req, res) => {
  const db = getDb();
  const order = db
    .prepare(`
      SELECT o.*,
             r.business_name as retailer_name, r.address as retailer_address, r.phone as retailer_phone,
             r.lat as retailer_lat, r.lng as retailer_lng,
             u.full_name as dispatcher_name, u.phone as dispatcher_phone,
             dp.vehicle_type as dispatcher_vehicle, dp.plate_number as dispatcher_plate,
             dp.rating_avg as dispatcher_rating,
             dp.current_lat as dispatcher_lat, dp.current_lng as dispatcher_lng,
             dp.location_tracking_enabled as dispatcher_tracking_enabled,
             dp.location_updated_at as dispatcher_location_updated_at
      FROM orders o
      JOIN retailers r ON r.id = o.retailer_id
      LEFT JOIN users u ON u.id = o.dispatcher_id
      LEFT JOIN dispatcher_profiles dp ON dp.user_id = o.dispatcher_id
      WHERE o.id = ? AND o.customer_id = ?
    `)
    .get(Number(req.params.id), req.user!.id) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }

  const items = db
    .prepare(
      'SELECT id, order_id, product_id, product_name, size_kg, quantity, unit_price_kobo, line_total_kobo FROM order_items WHERE order_id = ?'
    )
    .all(Number(order.id));
  const timeline = db
    .prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC')
    .all(Number(order.id));
  const review = db.prepare('SELECT * FROM reviews WHERE order_id = ?').get(Number(order.id));
  const refund = db.prepare('SELECT * FROM refunds WHERE order_id = ?').get(Number(order.id));

  const activeStatuses = new Set([
    'ACCEPTED_BY_DISPATCHER',
    'AWAITING_COLLECTION',
    'COLLECTED_FROM_RETAILER',
    'IN_TRANSIT',
  ]);
  const isTrackingActive = activeStatuses.has(String(order.status)) && Number(order.dispatcher_tracking_enabled) === 1;
  const { retailer_supply_total_kobo: _s, platform_margin_kobo: _m, ...safeOrder } = order;

  res.json({
    order: {
      ...safeOrder,
      liveTrackingActive: isTrackingActive,
      dispatcher_lat: isTrackingActive ? order.dispatcher_lat : null,
      dispatcher_lng: isTrackingActive ? order.dispatcher_lng : null,
      items,
      timeline,
      review: review || null,
      refund: refund || null,
    },
  });
});

const createOrderSchema = z.object({
  retailerId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(20),
      })
    )
    .min(1, 'At least one product is required'),
  deliveryAddress: z.string().min(4, 'Delivery address is required').max(250),
  deliveryNeighbourhood: z.string().min(2).max(100),
  deliveryCity: z.string().min(2).max(80),
  deliveryState: z.string().min(2).max(80),
  deliveryLat: z.number(),
  deliveryLng: z.number(),
  deliveryInstructions: z.string().max(300).optional(),
  paymentMethod: z.enum(['WALLET', 'DIRECT_ONLINE']),
  gatewayProvider: z.enum(['PAYSTACK', 'FLUTTERWAVE']).optional(),
  gatewayChannel: z.enum(['CARD', 'BANK_TRANSFER', 'USSD']).optional(),
  promoCode: z.string().max(40).optional(),
  idempotencyKey: z.string().max(100).optional(),
});

router.post('/orders', (req, res) => {
  // Explicitly reject Cash on Delivery / Cash payment attempts
  const rawMethod = String(req.body?.paymentMethod || '').toUpperCase();
  if (rawMethod === 'CASH' || rawMethod === 'CASH_ON_DELIVERY' || rawMethod === 'COD') {
    res.status(400).json({
      error:
        'Cash on delivery and physical cash payments are strictly prohibited. Please pay electronically via your BlueFlame Wallet or Paystack/Flutterwave.',
    });
    return;
  }

  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid checkout payload.' });
    return;
  }

  const d = parsed.data;
  const db = getDb();

  // 1. Verify retailer is APPROVED_ACTIVE & open
  const retailer = db
    .prepare("SELECT * FROM retailers WHERE id = ? AND status = 'APPROVED_ACTIVE'")
    .get(d.retailerId) as
    | {
        id: number;
        business_name: string;
        lat: number;
        lng: number;
        city: string;
        state: string;
        is_open_now: number;
        max_delivery_radius_km: number;
        coverage_areas_json: string;
        base_delivery_fee_kobo: number;
        per_km_delivery_fee_kobo: number;
        estimated_prep_mins: number;
      }
    | undefined;

  if (!retailer) {
    res.status(404).json({ error: 'Selected retailer is not currently available for ordering.' });
    return;
  }
  if (!retailer.is_open_now) {
    res.status(400).json({ error: `${retailer.business_name} is currently closed and not accepting orders.` });
    return;
  }

  // 2. MANDATORY: Verify delivery coverage BEFORE allowing checkout!
  const coverage = checkRetailerCoverage(retailer, {
    lat: d.deliveryLat,
    lng: d.deliveryLng,
    neighbourhood: d.deliveryNeighbourhood,
    city: d.deliveryCity,
    state: d.deliveryState,
  });
  if (!coverage.canDeliver) {
    res.status(400).json({
      error: `${retailer.business_name} cannot deliver to your selected address: ${coverage.reason}. Please select a retailer covering your area.`,
      coverage,
    });
    return;
  }

  // 3. Authoritatively compute prices & verify stock from DB (never trust client-sent prices!)
  let subtotalKobo = 0;
  let supplyTotalKobo = 0;
  const resolvedItems: {
    retailerProductId: number;
    productId: number;
    productName: string;
    sizeKg: number | null;
    quantity: number;
    unitPriceKobo: number;
    unitSupplyCostKobo: number;
    lineTotalKobo: number;
  }[] = [];

  for (const item of d.items) {
    const rp = db
      .prepare(`
        SELECT rp.id, rp.product_id, rp.selling_price_kobo, rp.retailer_supply_cost_kobo,
               rp.stock_quantity, rp.is_available, p.name as product_name, p.size_kg
        FROM retailer_products rp
        JOIN products p ON p.id = rp.product_id
        WHERE rp.retailer_id = ? AND rp.product_id = ? AND p.is_active = 1
      `)
      .get(retailer.id, item.productId) as
      | {
          id: number;
          product_id: number;
          selling_price_kobo: number;
          retailer_supply_cost_kobo: number;
          stock_quantity: number;
          is_available: number;
          product_name: string;
          size_kg: number | null;
        }
      | undefined;

    if (!rp || !rp.is_available) {
      res.status(400).json({ error: 'One or more selected products are no longer available at this retailer.' });
      return;
    }
    if (rp.stock_quantity < item.quantity) {
      res.status(400).json({
        error: `Only ${rp.stock_quantity} unit(s) of ${rp.product_name} remain in stock at ${retailer.business_name}.`,
      });
      return;
    }

    const lineTotal = rp.selling_price_kobo * item.quantity;
    subtotalKobo += lineTotal;
    supplyTotalKobo += rp.retailer_supply_cost_kobo * item.quantity;
    resolvedItems.push({
      retailerProductId: rp.id,
      productId: rp.product_id,
      productName: rp.product_name,
      sizeKg: rp.size_kg,
      quantity: item.quantity,
      unitPriceKobo: rp.selling_price_kobo,
      unitSupplyCostKobo: rp.retailer_supply_cost_kobo,
      lineTotalKobo: lineTotal,
    });
  }

  // 4. Promo code calculation
  let discountKobo = 0;
  let appliedPromoCode: string | null = null;
  if (d.promoCode && d.promoCode.trim()) {
    const promo = db
      .prepare("SELECT * FROM promotions WHERE code = ? AND is_active = 1 AND date('now') BETWEEN date(valid_from) AND date(valid_until)")
      .get(d.promoCode.trim().toUpperCase()) as
      | {
          code: string;
          discount_type: 'FIXED' | 'PERCENT';
          discount_value: number;
          min_order_kobo: number;
          max_discount_kobo: number;
          usage_limit: number;
          used_count: number;
        }
      | undefined;
    if (promo && promo.used_count < promo.usage_limit && subtotalKobo >= promo.min_order_kobo) {
      discountKobo =
        promo.discount_type === 'FIXED'
          ? Math.min(promo.discount_value, promo.max_discount_kobo, subtotalKobo)
          : Math.min(Math.round((subtotalKobo * promo.discount_value) / 100), promo.max_discount_kobo, subtotalKobo);
      appliedPromoCode = promo.code;
    }
  }

  const deliveryFeeKobo = coverage.deliveryFeeKobo;
  const serviceFeeKobo = calculateServiceFeeKobo(subtotalKobo);
  const totalAmountKobo = Math.max(0, subtotalKobo + deliveryFeeKobo + serviceFeeKobo - discountKobo);
  const platformMarginKobo = Math.max(0, subtotalKobo - supplyTotalKobo + serviceFeeKobo - discountKobo);
  const confirmationCode = String(crypto.randomInt(1000, 9999));
  const orderReference = generateReference('BF-ORD');

  // Pre-check wallet balance BEFORE creating order if WALLET payment was chosen
  if (d.paymentMethod === 'WALLET') {
    const wallet = ensureWalletForUser(req.user!.id);
    if (wallet.balance_kobo < totalAmountKobo) {
      const shortfall = totalAmountKobo - wallet.balance_kobo;
      res.status(402).json({
        code: 'INSUFFICIENT_WALLET_BALANCE',
        error: `Insufficient wallet balance. Available: ₦${(wallet.balance_kobo / 100).toLocaleString()}, Order Total: ₦${(totalAmountKobo / 100).toLocaleString()}. Please fund your wallet with at least ₦${(shortfall / 100).toLocaleString()}.`,
        walletBalanceKobo: wallet.balance_kobo,
        totalAmountKobo,
        shortfallKobo: shortfall,
      });
      return;
    }
  }

  // Create order record in AWAITING_PAYMENT
  const orderId = runInTransaction((tdb) => {
    const info = tdb
      .prepare(`
        INSERT INTO orders (
          order_reference, customer_id, retailer_id, status, payment_method, payment_status,
          delivery_address, delivery_neighbourhood, delivery_city, delivery_state,
          delivery_lat, delivery_lng, delivery_instructions, distance_km, estimated_delivery_mins,
          subtotal_kobo, retailer_supply_total_kobo, delivery_fee_kobo, service_fee_kobo,
          discount_kobo, promo_code, total_amount_kobo, platform_margin_kobo, delivery_confirmation_code
        ) VALUES (?, ?, ?, 'AWAITING_PAYMENT', ?, 'AWAITING_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        orderReference,
        req.user!.id,
        retailer.id,
        d.paymentMethod,
        d.deliveryAddress.trim(),
        d.deliveryNeighbourhood.trim(),
        d.deliveryCity.trim(),
        d.deliveryState.trim(),
        d.deliveryLat,
        d.deliveryLng,
        d.deliveryInstructions?.trim() || '',
        coverage.distanceKm,
        coverage.estimatedDeliveryMins,
        subtotalKobo,
        supplyTotalKobo,
        deliveryFeeKobo,
        serviceFeeKobo,
        discountKobo,
        appliedPromoCode,
        totalAmountKobo,
        platformMarginKobo,
        confirmationCode
      );
    const createdId = Number(info.lastInsertRowid);

    const insItem = tdb.prepare(`
      INSERT INTO order_items (
        order_id, retailer_product_id, product_id, product_name, size_kg,
        quantity, unit_price_kobo, unit_supply_cost_kobo, line_total_kobo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ri of resolvedItems) {
      insItem.run(
        createdId,
        ri.retailerProductId,
        ri.productId,
        ri.productName,
        ri.sizeKg,
        ri.quantity,
        ri.unitPriceKobo,
        ri.unitSupplyCostKobo,
        ri.lineTotalKobo
      );
    }

    tdb
      .prepare(`
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
        VALUES (?, NULL, 'AWAITING_PAYMENT', ?, 'CUSTOMER', ?)
      `)
      .run(createdId, req.user!.id, `Order created (${d.paymentMethod}); awaiting verified electronic payment`);

    return createdId;
  });

  // Option A: Execute atomic Wallet debit & confirmation immediately
  if (d.paymentMethod === 'WALLET') {
    try {
      const paid = payOrderWithWallet(orderId, req.user!.id, d.idempotencyKey);
      res.status(201).json({
        orderId,
        orderReference: paid.orderReference,
        status: 'AWAITING_DISPATCHER_ASSIGNMENT',
        paymentStatus: 'PAID',
        paymentReference: paid.paymentReference,
        newWalletBalanceKobo: paid.newWalletBalanceKobo,
        totalAmountKobo,
        confirmationCode,
        requiresGatewayVerification: false,
      });
      return;
    } catch (err) {
      const e = err as Error & { code?: string; shortfallKobo?: number };
      res.status(e.code === 'INSUFFICIENT_WALLET_BALANCE' ? 402 : 400).json({
        error: e.message,
        code: e.code,
        shortfallKobo: e.shortfallKobo,
      });
      return;
    }
  }

  // Option B: Direct Online Payment — order stays AWAITING_PAYMENT until server verifies gateway!
  const gw = initializeGatewayTransaction({
    userId: req.user!.id,
    purpose: 'ORDER_PAYMENT',
    orderId,
    provider: d.gatewayProvider || 'PAYSTACK',
    channel: d.gatewayChannel || 'CARD',
    amountKobo: totalAmountKobo,
    idempotencyKey: d.idempotencyKey,
  });

  res.status(201).json({
    orderId,
    orderReference,
    status: 'AWAITING_PAYMENT',
    paymentStatus: 'AWAITING_PAYMENT',
    totalAmountKobo,
    confirmationCode,
    requiresGatewayVerification: true,
    gateway: gw,
  });
});

// Electronic Payment Receipt
router.get('/orders/:id/receipt', (req, res) => {
  const db = getDb();
  const order = db
    .prepare(`
      SELECT o.*, r.business_name as retailer_name, r.address as retailer_address, r.phone as retailer_phone,
             u.full_name as customer_name, u.email as customer_email, u.phone as customer_phone
      FROM orders o
      JOIN retailers r ON r.id = o.retailer_id
      JOIN users u ON u.id = o.customer_id
      WHERE o.id = ? AND o.customer_id = ?
    `)
    .get(Number(req.params.id), req.user!.id) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Receipt not found.' });
    return;
  }
  const items = db
    .prepare('SELECT product_name, size_kg, quantity, unit_price_kobo, line_total_kobo FROM order_items WHERE order_id = ?')
    .all(Number(order.id));

  res.json({
    receipt: {
      receiptNumber: `RCP-${order.order_reference}`,
      orderReference: order.order_reference,
      paymentReference: order.payment_reference || 'PENDING',
      paymentMethod: order.payment_method,
      gatewayProvider: order.gateway_provider,
      paymentStatus: order.payment_status,
      issuedAt: order.created_at,
      customer: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
      },
      retailer: {
        name: order.retailer_name,
        address: order.retailer_address,
        phone: order.retailer_phone,
      },
      deliveryAddress: `${order.delivery_address}, ${order.delivery_neighbourhood}, ${order.delivery_city}`,
      subtotalKobo: order.subtotal_kobo,
      deliveryFeeKobo: order.delivery_fee_kobo,
      serviceFeeKobo: order.service_fee_kobo,
      discountKobo: order.discount_kobo,
      totalAmountKobo: order.total_amount_kobo,
      cashlessStatement: 'PAID ELECTRONICALLY — NO CASH ACCEPTED ON DELIVERY',
      items,
    },
  });
});

// Customer cancels eligible order before collection
router.post('/orders/:id/cancel', (req, res) => {
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'Customer requested cancellation';
  const db = getDb();
  const order = db
    .prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?')
    .get(Number(req.params.id), req.user!.id) as
    | {
        id: number;
        order_reference: string;
        status: string;
        payment_status: string;
        total_amount_kobo: number;
        dispatcher_id: number | null;
      }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }

  const cancellable = ['AWAITING_PAYMENT', 'AWAITING_DISPATCHER_ASSIGNMENT', 'ASSIGNED_TO_DISPATCHER'];
  if (!cancellable.includes(order.status)) {
    res.status(400).json({
      error: 'Order is already being collected or in transit. Please contact Operations Support for assistance.',
    });
    return;
  }

  runInTransaction((tdb) => {
    const nextStatus = order.payment_status === 'PAID' ? 'REFUND_PROCESSING' : 'CANCELLED';
    tdb
      .prepare(`
        UPDATE orders
        SET status = ?, payment_status = CASE WHEN payment_status = 'PAID' THEN 'REFUND_PROCESSING' ELSE payment_status END,
            cancelled_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `)
      .run(nextStatus, order.id);

    tdb
      .prepare(`
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
        VALUES (?, ?, ?, ?, 'CUSTOMER', ?)
      `)
      .run(order.id, order.status, nextStatus, req.user!.id, `Customer cancelled order: ${reason}`);

    if (order.payment_status === 'PAID') {
      const existingRef = tdb.prepare('SELECT id FROM refunds WHERE order_id = ?').get(order.id);
      if (!existingRef) {
        tdb
          .prepare(`
            INSERT INTO refunds (order_id, customer_id, amount_kobo, destination, reason, status, refund_reference)
            VALUES (?, ?, ?, 'WALLET', ?, 'REQUESTED', ?)
          `)
          .run(order.id, req.user!.id, order.total_amount_kobo, reason, generateReference('BF-REF'));
      }
    }
  });

  if (order.dispatcher_id) {
    createNotification({
      userId: order.dispatcher_id,
      roleScope: 'DISPATCHER',
      title: 'Assigned Order Cancelled',
      message: `Order ${order.order_reference} has been cancelled by the customer prior to collection.`,
      type: 'ORDER',
      relatedOrderId: order.id,
    });
  }

  notifyAllAdmins({
    title: order.payment_status === 'PAID' ? 'Refund Request from Cancelled Order' : 'Order Cancelled',
    message: `Customer cancelled order ${order.order_reference}. Reason: ${reason}.`,
    type: 'REFUND',
    relatedOrderId: order.id,
  });

  broadcastOrderUpdate(order.id, req.user!.id, order.dispatcher_id, order.payment_status === 'PAID' ? 'REFUND_PROCESSING' : 'CANCELLED');

  res.json({
    ok: true,
    status: order.payment_status === 'PAID' ? 'REFUND_PROCESSING' : 'CANCELLED',
    message:
      order.payment_status === 'PAID'
        ? 'Order cancelled. A wallet refund request has been submitted to Operations Admin for approval.'
        : 'Unpaid order cancelled.',
  });
});

// Rate & Review completed delivery
router.post('/orders/:id/review', (req, res) => {
  const schema = z.object({
    retailerRating: z.number().int().min(1).max(5),
    dispatcherRating: z.number().int().min(1).max(5).optional(),
    comment: z.string().max(600).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review.' });
    return;
  }

  const db = getDb();
  const order = db
    .prepare("SELECT id, retailer_id, dispatcher_id, status FROM orders WHERE id = ? AND customer_id = ?")
    .get(Number(req.params.id), req.user!.id) as
    | { id: number; retailer_id: number; dispatcher_id: number | null; status: string }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (order.status !== 'DELIVERED') {
    res.status(400).json({ error: 'You can only review completed deliveries.' });
    return;
  }

  try {
    runInTransaction((tdb) => {
      tdb
        .prepare(`
          INSERT INTO reviews (order_id, customer_id, retailer_id, dispatcher_id, retailer_rating, dispatcher_rating, comment)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          order.id,
          req.user!.id,
          order.retailer_id,
          order.dispatcher_id,
          parsed.data.retailerRating,
          parsed.data.dispatcherRating ?? parsed.data.retailerRating,
          parsed.data.comment?.trim() || ''
        );

      // Update retailer aggregate rating
      const rStats = tdb
        .prepare('SELECT AVG(retailer_rating) as avg_r, COUNT(*) as cnt FROM reviews WHERE retailer_id = ? AND is_visible = 1')
        .get(order.retailer_id) as { avg_r: number; cnt: number };
      tdb
        .prepare('UPDATE retailers SET rating_avg = ?, review_count = ? WHERE id = ?')
        .run(Math.round((rStats.avg_r || 5) * 10) / 10, rStats.cnt, order.retailer_id);

      // Update dispatcher aggregate rating
      if (order.dispatcher_id) {
        const dStats = tdb
          .prepare('SELECT AVG(dispatcher_rating) as avg_d FROM reviews WHERE dispatcher_id = ? AND dispatcher_rating IS NOT NULL')
          .get(order.dispatcher_id) as { avg_d: number };
        if (dStats.avg_d) {
          tdb
            .prepare('UPDATE dispatcher_profiles SET rating_avg = ? WHERE user_id = ?')
            .run(Math.round(dStats.avg_d * 10) / 10, order.dispatcher_id);
        }
      }
    });
    res.status(201).json({ ok: true });
  } catch {
    res.status(409).json({ error: 'You have already reviewed this order.' });
  }
});

// Complaints & Customer Support
router.get('/complaints', (req, res) => {
  const db = getDb();
  const complaints = db
    .prepare(`
      SELECT c.*, o.order_reference
      FROM complaints c
      LEFT JOIN orders o ON o.id = c.order_id
      WHERE c.customer_id = ?
      ORDER BY c.created_at DESC
    `)
    .all(req.user!.id);
  res.json({ complaints });
});

router.post('/complaints', (req, res) => {
  const schema = z.object({
    orderId: z.number().int().positive().optional().nullable(),
    category: z.string().min(2).max(60),
    subject: z.string().min(4).max(160),
    description: z.string().min(10).max(1500),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Please complete all complaint fields.' });
    return;
  }

  const db = getDb();
  const ticketNumber = generateReference('BF-TKT');
  const info = db
    .prepare(`
      INSERT INTO complaints (ticket_number, customer_id, order_id, category, subject, description, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      ticketNumber,
      req.user!.id,
      parsed.data.orderId ?? null,
      parsed.data.category,
      parsed.data.subject.trim(),
      parsed.data.description.trim(),
      parsed.data.priority || 'MEDIUM'
    );

  notifyAllAdmins({
    title: `New Customer Complaint (${ticketNumber})`,
    message: `${req.user!.full_name} submitted a ${parsed.data.category} ticket: ${parsed.data.subject.trim()}`,
    type: 'ALERT',
    relatedOrderId: parsed.data.orderId ?? null,
  });

  const complaint = db.prepare('SELECT * FROM complaints WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ complaint });
});

export default router;
