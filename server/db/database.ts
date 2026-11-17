import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseDbEnabled } from '../lib/supabase.js';

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface DbClient {
  readonly dialect: 'postgres' | 'sqlite';
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
}

const DEFAULT_DATA_DIR = process.env.VERCEL
  ? '/tmp/blueflame-data'
  : path.resolve(process.cwd(), 'data');

export const DB_PATH = process.env.BLUEFLAME_DB_PATH || path.join(DEFAULT_DATA_DIR, 'blueflame.db');

let sqliteInstance: DatabaseSync | null = null;
let sqliteClient: DbClient | null = null;
let pgClient: DbClient | null = null;
let sqliteTxDepth = 0;

/**
 * Converts standard `?` parameterized SQL (plus tiny SQLite idioms like datetime('now'))
 * to PostgreSQL `$1, $2, ...` syntax without modifying string literals.
 */
function translateSqlForPostgres(sql: string): string {
  let out = '';
  let inStr = false;
  let paramIdx = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        if (i + 1 < sql.length && sql[i + 1] === "'") {
          out += "'";
          i += 1;
        } else {
          inStr = false;
        }
      }
    } else if (ch === "'") {
      inStr = true;
      out += ch;
    } else if (ch === '?') {
      paramIdx += 1;
      out += `$${paramIdx}`;
    } else {
      out += ch;
    }
  }

  // Replace datetime('now') with UTC timestamp string matching existing column convention
  out = out.replace(/datetime\s*\(\s*'now'\s*\)/gi, "to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");

  // Convert INSERT OR IGNORE INTO ... -> INSERT INTO ... ON CONFLICT DO NOTHING
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
    if (!/\bON\s+CONFLICT\b/i.test(out)) {
      out = `${out.trim().replace(/;$/, '')} ON CONFLICT DO NOTHING`;
    }
  }

  // Convert INSERT OR REPLACE INTO platform_settings ...
  if (/^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+platform_settings\b/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+platform_settings\b/i, 'INSERT INTO platform_settings');
    if (!/\bON\s+CONFLICT\b/i.test(out)) {
      out = `${out.trim().replace(/;$/, '')} ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
    }
  }

  return out;
}

function normalizePgParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

async function callSupabaseExecSql(
  sql: string,
  params: unknown[],
  mode: 'query' | 'exec',
  appendReturningId = false
): Promise<{ rows: Record<string, unknown>[]; changes: number }> {
  const supabase = getSupabaseAdmin();
  let pgSql = translateSqlForPostgres(sql).trim().replace(/;$/, '');
  if (appendReturningId && !/\bRETURNING\b/i.test(pgSql)) {
    pgSql = `${pgSql} RETURNING id`;
  }
  const { data, error } = await supabase.rpc('exec_sql', {
    p_sql: pgSql,
    p_params: normalizePgParams(params),
    p_mode: mode,
  });

  if (error) {
    throw new Error(`Supabase DB error: ${error.message}`);
  }
  const payload = (data || { rows: [], changes: 0 }) as {
    rows?: Record<string, unknown>[];
    changes?: number;
  };
  return {
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    changes: Number(payload.changes || 0),
  };
}

function getPostgresClient(): DbClient {
  if (!pgClient) {
    pgClient = {
      dialect: 'postgres',
      async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
        const res = await callSupabaseExecSql(sql, params, 'query');
        return res.rows[0] as T | undefined;
      },
      async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
        const res = await callSupabaseExecSql(sql, params, 'query');
        return res.rows as T[];
      },
      async run(sql: string, ...params: unknown[]): Promise<RunResult> {
        const trimmed = sql.trim().replace(/;$/, '');
        const isInsert = /^\s*INSERT\b/i.test(trimmed);
        const isPlatformSettings = /\bINTO\s+platform_settings\b/i.test(trimmed);
        const hasReturning = /\bRETURNING\b/i.test(trimmed);

        if (isInsert && !isPlatformSettings && !hasReturning) {
          const res = await callSupabaseExecSql(trimmed, params, 'query', true);
          const firstRow = res.rows[0] as { id?: number | string } | undefined;
          return {
            changes: res.changes,
            lastInsertRowid: firstRow?.id !== undefined ? Number(firstRow.id) : 0,
          };
        }

        if (hasReturning) {
          const res = await callSupabaseExecSql(trimmed, params, 'query');
          const firstRow = res.rows[0] as { id?: number | string } | undefined;
          return {
            changes: res.changes,
            lastInsertRowid: firstRow?.id !== undefined ? Number(firstRow.id) : 0,
          };
        }

        const res = await callSupabaseExecSql(trimmed, params, 'exec');
        return { changes: res.changes, lastInsertRowid: 0 };
      },
    };
  }
  return pgClient;
}

function getSqliteNative(): DatabaseSync {
  if (!sqliteInstance) {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    sqliteInstance = new DatabaseSync(DB_PATH);
    try {
      sqliteInstance.exec('PRAGMA journal_mode = WAL;');
    } catch {
      sqliteInstance.exec('PRAGMA journal_mode = DELETE;');
    }
    sqliteInstance.exec('PRAGMA foreign_keys = ON;');
    sqliteInstance.exec('PRAGMA busy_timeout = 5000;');
    initializeSqliteSchema(sqliteInstance);
  }
  return sqliteInstance;
}

function getSqliteClient(): DbClient {
  if (!sqliteClient) {
    const native = getSqliteNative();
    sqliteClient = {
      dialect: 'sqlite',
      async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
        return native.prepare(sql).get(...(params as never[])) as T | undefined;
      },
      async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
        return native.prepare(sql).all(...(params as never[])) as T[];
      },
      async run(sql: string, ...params: unknown[]): Promise<RunResult> {
        const info = native.prepare(sql).run(...(params as never[]));
        return {
          changes: Number(info.changes || 0),
          lastInsertRowid: Number(info.lastInsertRowid || 0),
        };
      },
    };
  }
  return sqliteClient;
}

export function getDb(): DbClient {
  if (isSupabaseDbEnabled()) {
    return getPostgresClient();
  }
  return getSqliteClient();
}

export async function runInTransaction<T>(fn: (db: DbClient) => Promise<T>): Promise<T> {
  const db = getDb();
  if (db.dialect === 'postgres') {
    // Each Supabase RPC statement is ACID; critical financial deductions/credits use atomic SQL guards + idempotency keys
    return await fn(db);
  }

  const native = getSqliteNative();
  const isNested = sqliteTxDepth > 0;
  const savepoint = `sp_${sqliteTxDepth + 1}`;
  if (isNested) {
    native.exec(`SAVEPOINT ${savepoint}`);
  } else {
    native.exec('BEGIN IMMEDIATE');
  }
  sqliteTxDepth += 1;
  try {
    const result = await fn(db);
    sqliteTxDepth -= 1;
    if (isNested) {
      native.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } else {
      native.exec('COMMIT');
    }
    return result;
  } catch (err) {
    sqliteTxDepth -= 1;
    try {
      if (isNested) {
        native.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        native.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else {
        native.exec('ROLLBACK');
      }
    } catch {
      // Ignore rollback errors if already rolled back
    }
    throw err;
  }
}

function initializeSqliteSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_user_id TEXT UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('CUSTOMER', 'DISPATCHER', 'ADMIN')),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
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
      zone TEXT NOT NULL DEFAULT 'Ewet Housing / Oron Road',
      availability_status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK(availability_status IN ('ONLINE', 'BUSY', 'OFFLINE')),
      current_lat REAL NOT NULL DEFAULT 5.0377,
      current_lng REAL NOT NULL DEFAULT 7.9128,
      location_tracking_enabled INTEGER NOT NULL DEFAULT 0,
      location_updated_at TEXT,
      compensation_model TEXT NOT NULL DEFAULT 'FIXED_PLUS_DISTANCE' CHECK(compensation_model IN ('FIXED', 'DISTANCE', 'ZONE', 'FIXED_PLUS_DISTANCE')),
      base_rate_kobo INTEGER NOT NULL DEFAULT 75000,
      per_km_rate_kobo INTEGER NOT NULL DEFAULT 7500,
      rating_avg REAL NOT NULL DEFAULT 5.0,
      completed_deliveries_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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
      cover_image_url TEXT DEFAULT '/images/depot-ewet.jpg',
      description TEXT NOT NULL DEFAULT '',
      operating_hours_json TEXT NOT NULL DEFAULT '{}',
      is_open_now INTEGER NOT NULL DEFAULT 1,
      max_delivery_radius_km REAL NOT NULL DEFAULT 9.0,
      coverage_areas_json TEXT NOT NULL DEFAULT '[]',
      base_delivery_fee_kobo INTEGER NOT NULL DEFAULT 85000,
      per_km_delivery_fee_kobo INTEGER NOT NULL DEFAULT 10000,
      estimated_prep_mins INTEGER NOT NULL DEFAULT 12,
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
      image_url TEXT NOT NULL DEFAULT '/images/prod-refill-12-5kg.jpg',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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
        'AWAITING_PAYMENT','PAYMENT_CONFIRMED','ORDER_RECEIVED','AWAITING_DISPATCHER_ASSIGNMENT',
        'ASSIGNED_TO_DISPATCHER','ACCEPTED_BY_DISPATCHER','AWAITING_COLLECTION','COLLECTED_FROM_RETAILER',
        'IN_TRANSIT','DELIVERED','DELIVERY_FAILED','CANCELLED','REFUND_PROCESSING','REFUNDED'
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
      estimated_delivery_mins INTEGER NOT NULL DEFAULT 30,
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
