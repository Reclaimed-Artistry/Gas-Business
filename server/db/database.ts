import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DATA_DIR = process.env.VERCEL
  ? '/tmp/blueflame-data'
  : path.resolve(process.cwd(), 'data');

export const DB_PATH = process.env.BLUEFLAME_DB_PATH || path.join(DEFAULT_DATA_DIR, 'blueflame.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbInstance: DatabaseSync | null = null;
let txDepth = 0;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    try {
      dbInstance.exec('PRAGMA journal_mode = WAL;');
    } catch {
      dbInstance.exec('PRAGMA journal_mode = DELETE;');
    }
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    initializeSchema(dbInstance);
  }
  return dbInstance;
}

export function runInTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  const isNested = txDepth > 0;
  const savepoint = `sp_${txDepth + 1}`;
  if (isNested) {
    db.exec(`SAVEPOINT ${savepoint}`);
  } else {
    db.exec('BEGIN IMMEDIATE');
  }
  txDepth += 1;
  try {
    const result = fn(db);
    txDepth -= 1;
    if (isNested) {
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } else {
      db.exec('COMMIT');
    }
    return result;
  } catch (err) {
    txDepth -= 1;
    try {
      if (isNested) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else {
        db.exec('ROLLBACK');
      }
    } catch {
      // Ignore rollback errors if connection already rolled back
    }
    throw err;
  }
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('CUSTOMER', 'DISPATCHER', 'ADMIN')),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customer_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      address_line TEXT NOT NULL,
      neighbourhood TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      delivery_instructions TEXT DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dispatcher_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      vehicle_type TEXT NOT NULL DEFAULT 'Motorcycle',
      plate_number TEXT NOT NULL,
      license_number TEXT NOT NULL,
      zone TEXT NOT NULL DEFAULT 'Lagos Island',
      availability_status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK(availability_status IN ('ONLINE', 'BUSY', 'OFFLINE')),
      current_lat REAL NOT NULL DEFAULT 6.4541,
      current_lng REAL NOT NULL DEFAULT 3.3947,
      location_tracking_enabled INTEGER NOT NULL DEFAULT 0,
      location_updated_at TEXT,
      compensation_model TEXT NOT NULL DEFAULT 'FIXED_PLUS_DISTANCE' CHECK(compensation_model IN ('FIXED', 'DISTANCE', 'ZONE', 'FIXED_PLUS_DISTANCE')),
      base_rate_kobo INTEGER NOT NULL DEFAULT 80000,
      per_km_rate_kobo INTEGER NOT NULL DEFAULT 8000,
      rating_avg REAL NOT NULL DEFAULT 5.0,
      completed_deliveries_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Retailers are centrally managed by Admin ONLY. Zero login credentials or accounts.
    CREATE TABLE IF NOT EXISTS retailers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      contact_person TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT DEFAULT '',
      address TEXT NOT NULL,
      neighbourhood TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      logo_url TEXT DEFAULT '',
      cover_image_url TEXT DEFAULT '/images/retailer-depot.jpg',
      description TEXT NOT NULL DEFAULT '',
      operating_hours_json TEXT NOT NULL DEFAULT '{}',
      is_open_now INTEGER NOT NULL DEFAULT 1,
      max_delivery_radius_km REAL NOT NULL DEFAULT 10.0,
      coverage_areas_json TEXT NOT NULL DEFAULT '[]',
      base_delivery_fee_kobo INTEGER NOT NULL DEFAULT 100000,
      per_km_delivery_fee_kobo INTEGER NOT NULL DEFAULT 12000,
      estimated_prep_mins INTEGER NOT NULL DEFAULT 15,
      status TEXT NOT NULL DEFAULT 'APPROVED_ACTIVE' CHECK(status IN ('APPROVED_ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL')),
      rating_avg REAL NOT NULL DEFAULT 4.8,
      review_count INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      created_by_admin_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS favourite_retailers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, retailer_id)
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('GAS_REFILL', 'CYLINDER', 'ACCESSORY')),
      description TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES product_categories(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      size_kg REAL,
      unit_label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '/images/product-refill-12kg.jpg',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Independent per-retailer pricing & stock controlled exclusively by Administrator
    CREATE TABLE IF NOT EXISTS retailer_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      selling_price_kobo INTEGER NOT NULL CHECK(selling_price_kobo > 0),
      retailer_supply_cost_kobo INTEGER NOT NULL CHECK(retailer_supply_cost_kobo >= 0),
      stock_quantity INTEGER NOT NULL DEFAULT 25 CHECK(stock_quantity >= 0),
      is_available INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(retailer_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance_kobo INTEGER NOT NULL DEFAULT 0 CHECK(balance_kobo >= 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gateway_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      purpose TEXT NOT NULL CHECK(purpose IN ('WALLET_FUNDING', 'ORDER_PAYMENT')),
      order_id INTEGER,
      provider TEXT NOT NULL CHECK(provider IN ('PAYSTACK', 'FLUTTERWAVE')),
      channel TEXT NOT NULL DEFAULT 'CARD' CHECK(channel IN ('CARD', 'BANK_TRANSFER', 'USSD')),
      amount_kobo INTEGER NOT NULL CHECK(amount_kobo > 0),
      currency TEXT NOT NULL DEFAULT 'NGN',
      status TEXT NOT NULL DEFAULT 'INITIALIZED' CHECK(status IN ('INITIALIZED', 'PENDING', 'VERIFIED_SUCCESS', 'FAILED')),
      provider_response_json TEXT DEFAULT '{}',
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      reference TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('FUNDING', 'ORDER_PAYMENT', 'REFUND', 'ADMIN_ADJUSTMENT')),
      direction TEXT NOT NULL CHECK(direction IN ('CREDIT', 'DEBIT')),
      amount_kobo INTEGER NOT NULL CHECK(amount_kobo > 0),
      balance_before_kobo INTEGER NOT NULL,
      balance_after_kobo INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'SUCCESS', 'FAILED')),
      payment_method TEXT NOT NULL,
      gateway_provider TEXT,
      gateway_reference TEXT,
      order_id INTEGER,
      description TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      discount_type TEXT NOT NULL CHECK(discount_type IN ('FIXED', 'PERCENT')),
      discount_value INTEGER NOT NULL,
      min_order_kobo INTEGER NOT NULL DEFAULT 0,
      max_discount_kobo INTEGER NOT NULL DEFAULT 500000,
      usage_limit INTEGER NOT NULL DEFAULT 1000,
      used_count INTEGER NOT NULL DEFAULT 0,
      valid_from TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_reference TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      retailer_id INTEGER NOT NULL REFERENCES retailers(id),
      dispatcher_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK(status IN (
        'AWAITING_PAYMENT',
        'PAYMENT_CONFIRMED',
        'ORDER_RECEIVED',
        'AWAITING_DISPATCHER_ASSIGNMENT',
        'ASSIGNED_TO_DISPATCHER',
        'ACCEPTED_BY_DISPATCHER',
        'AWAITING_COLLECTION',
        'COLLECTED_FROM_RETAILER',
        'IN_TRANSIT',
        'DELIVERED',
        'DELIVERY_FAILED',
        'CANCELLED',
        'REFUND_PROCESSING',
        'REFUNDED'
      )),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('WALLET', 'DIRECT_ONLINE')),
      payment_status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK(payment_status IN ('AWAITING_PAYMENT', 'PAID', 'FAILED', 'REFUND_PROCESSING', 'REFUNDED')),
      payment_reference TEXT,
      gateway_provider TEXT,
      delivery_address TEXT NOT NULL,
      delivery_neighbourhood TEXT NOT NULL,
      delivery_city TEXT NOT NULL,
      delivery_state TEXT NOT NULL,
      delivery_lat REAL NOT NULL,
      delivery_lng REAL NOT NULL,
      delivery_instructions TEXT DEFAULT '',
      distance_km REAL NOT NULL DEFAULT 0,
      estimated_delivery_mins INTEGER NOT NULL DEFAULT 35,
      subtotal_kobo INTEGER NOT NULL,
      retailer_supply_total_kobo INTEGER NOT NULL,
      delivery_fee_kobo INTEGER NOT NULL,
      service_fee_kobo INTEGER NOT NULL,
      discount_kobo INTEGER NOT NULL DEFAULT 0,
      promo_code TEXT,
      total_amount_kobo INTEGER NOT NULL,
      platform_margin_kobo INTEGER NOT NULL DEFAULT 0,
      delivery_confirmation_code TEXT NOT NULL,
      proof_of_delivery_note TEXT DEFAULT '',
      proof_of_delivery_image TEXT DEFAULT '',
      failure_reason TEXT DEFAULT '',
      failure_notes TEXT DEFAULT '',
      assigned_at TEXT,
      accepted_at TEXT,
      collected_at TEXT,
      in_transit_at TEXT,
      delivered_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      retailer_product_id INTEGER NOT NULL REFERENCES retailer_products(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      size_kg REAL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price_kobo INTEGER NOT NULL,
      unit_supply_cost_kobo INTEGER NOT NULL,
      line_total_kobo INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_by_user_id INTEGER REFERENCES users(id),
      changed_by_role TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS retailer_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      retailer_id INTEGER NOT NULL REFERENCES retailers(id),
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      product_sale_kobo INTEGER NOT NULL,
      agreed_retailer_payout_kobo INTEGER NOT NULL,
      platform_margin_kobo INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')),
      settlement_reference TEXT UNIQUE,
      paid_at TEXT,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dispatcher_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dispatcher_id INTEGER NOT NULL REFERENCES users(id),
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      compensation_model TEXT NOT NULL,
      base_amount_kobo INTEGER NOT NULL,
      distance_bonus_kobo INTEGER NOT NULL DEFAULT 0,
      admin_bonus_kobo INTEGER NOT NULL DEFAULT 0,
      total_earning_kobo INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'PAID', 'REVERSED')),
      payout_reference TEXT UNIQUE,
      paid_at TEXT,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      amount_kobo INTEGER NOT NULL CHECK(amount_kobo > 0),
      destination TEXT NOT NULL DEFAULT 'WALLET' CHECK(destination IN ('WALLET', 'ORIGINAL_METHOD')),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED')),
      refund_reference TEXT NOT NULL UNIQUE,
      reviewed_by_admin_id INTEGER REFERENCES users(id),
      admin_notes TEXT DEFAULT '',
      wallet_transaction_id INTEGER REFERENCES wallet_transactions(id),
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      retailer_id INTEGER NOT NULL REFERENCES retailers(id),
      dispatcher_id INTEGER REFERENCES users(id),
      retailer_rating INTEGER NOT NULL CHECK(retailer_rating BETWEEN 1 AND 5),
      dispatcher_rating INTEGER CHECK(dispatcher_rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      order_id INTEGER REFERENCES orders(id),
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED')),
      priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH')),
      admin_response TEXT DEFAULT '',
      resolved_by_admin_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_scope TEXT NOT NULL CHECK(role_scope IN ('CUSTOMER', 'DISPATCHER', 'ADMIN')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'INFO',
      channels_json TEXT NOT NULL DEFAULT '["IN_APP"]',
      related_order_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      actor_user_id INTEGER REFERENCES users(id),
      actor_role TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      amount_kobo INTEGER NOT NULL DEFAULT 0,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_retailers_status ON retailers(status);
    CREATE INDEX IF NOT EXISTS idx_retailers_city_state ON retailers(state, city);
    CREATE INDEX IF NOT EXISTS idx_retailer_products_retailer ON retailer_products(retailer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_dispatcher ON orders(dispatcher_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  `);
}
