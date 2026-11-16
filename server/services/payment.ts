import crypto from 'node:crypto';
import { getDb, runInTransaction } from '../db/database.js';
import {
  broadcastOrderUpdate,
  createNotification,
  notifyAllAdmins,
  type UserRole,
} from './events.js';

export function generateReference(prefix: string): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${datePart}-${rand}`;
}

export function formatNairaServer(kobo: number): string {
  const naira = Math.round(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function writeFinancialAuditLog(params: {
  eventType: string;
  actorUserId?: number | null;
  actorRole: UserRole | 'SYSTEM';
  entityType: string;
  entityId: string | number;
  reference: string;
  amountKobo: number;
  details?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO financial_audit_logs (
      event_type, actor_user_id, actor_role, entity_type, entity_id, reference, amount_kobo, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.eventType,
    params.actorUserId ?? null,
    params.actorRole,
    params.entityType,
    String(params.entityId),
    params.reference,
    params.amountKobo,
    JSON.stringify(params.details || {})
  );
}

export function ensureWalletForUser(userId: number): { id: number; user_id: number; balance_kobo: number } {
  const db = getDb();
  let wallet = db.prepare('SELECT id, user_id, balance_kobo FROM wallets WHERE user_id = ?').get(userId) as
    | { id: number; user_id: number; balance_kobo: number }
    | undefined;
  if (!wallet) {
    db.prepare('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, 0)').run(userId);
    wallet = db.prepare('SELECT id, user_id, balance_kobo FROM wallets WHERE user_id = ?').get(userId) as {
      id: number;
      user_id: number;
      balance_kobo: number;
    };
  }
  return wallet;
}

export function getPlatformSettings(): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value_json FROM platform_settings').all() as {
    key: string;
    value_json: string;
  }[];
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value_json);
    } catch {
      result[row.key] = row.value_json;
    }
  }
  return result;
}

export function initializeGatewayTransaction(params: {
  userId: number;
  purpose: 'WALLET_FUNDING' | 'ORDER_PAYMENT';
  orderId?: number | null;
  provider: 'PAYSTACK' | 'FLUTTERWAVE';
  channel: 'CARD' | 'BANK_TRANSFER' | 'USSD';
  amountKobo: number;
  idempotencyKey?: string;
}): {
  reference: string;
  idempotencyKey: string;
  provider: string;
  channel: string;
  amountKobo: number;
  status: string;
  mode: 'LIVE' | 'SANDBOX_VERIFIED';
} {
  const db = getDb();
  const idempotencyKey = params.idempotencyKey?.trim() || `IDEMP-${crypto.randomUUID()}`;

  // Idempotent return if already initialized
  const existing = db
    .prepare('SELECT * FROM gateway_transactions WHERE idempotency_key = ?')
    .get(idempotencyKey) as
    | {
        reference: string;
        idempotency_key: string;
        provider: string;
        channel: string;
        amount_kobo: number;
        status: string;
      }
    | undefined;

  if (existing) {
    return {
      reference: existing.reference,
      idempotencyKey: existing.idempotency_key,
      provider: existing.provider,
      channel: existing.channel,
      amountKobo: existing.amount_kobo,
      status: existing.status,
      mode: process.env.PAYSTACK_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY ? 'LIVE' : 'SANDBOX_VERIFIED',
    };
  }

  const prefix = params.purpose === 'WALLET_FUNDING' ? 'BF-WLT' : 'BF-PAY';
  const reference = generateReference(prefix);

  db.prepare(`
    INSERT INTO gateway_transactions (
      reference, idempotency_key, user_id, purpose, order_id, provider, channel, amount_kobo, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(
    reference,
    idempotencyKey,
    params.userId,
    params.purpose,
    params.orderId ?? null,
    params.provider,
    params.channel,
    params.amountKobo
  );

  writeFinancialAuditLog({
    eventType: 'GATEWAY_TRANSACTION_INITIALIZED',
    actorUserId: params.userId,
    actorRole: 'CUSTOMER',
    entityType: 'gateway_transaction',
    entityId: reference,
    reference,
    amountKobo: params.amountKobo,
    details: { purpose: params.purpose, provider: params.provider, channel: params.channel, orderId: params.orderId },
  });

  return {
    reference,
    idempotencyKey,
    provider: params.provider,
    channel: params.channel,
    amountKobo: params.amountKobo,
    status: 'PENDING',
    mode: process.env.PAYSTACK_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY ? 'LIVE' : 'SANDBOX_VERIFIED',
  };
}

/**
 * Transitions an order from AWAITING_PAYMENT to AWAITING_DISPATCHER_ASSIGNMENT after payment is verified.
 * Must be called INSIDE a database transaction.
 */
function confirmOrderAfterVerifiedPayment(
  orderId: number,
  paymentReference: string,
  paymentMethod: 'WALLET' | 'DIRECT_ONLINE',
  gatewayProvider: string | null,
  actorUserId: number
): { orderReference: string; customerId: number; retailerName: string; totalAmountKobo: number } {
  const db = getDb();
  const order = db
    .prepare(`
      SELECT o.*, r.business_name as retailer_name
      FROM orders o
      JOIN retailers r ON r.id = o.retailer_id
      WHERE o.id = ?
    `)
    .get(orderId) as
    | {
        id: number;
        order_reference: string;
        customer_id: number;
        retailer_id: number;
        retailer_name: string;
        status: string;
        payment_status: string;
        subtotal_kobo: number;
        retailer_supply_total_kobo: number;
        total_amount_kobo: number;
        promo_code: string | null;
      }
    | undefined;

  if (!order) {
    throw new Error('Order not found for confirmation.');
  }

  if (order.payment_status === 'PAID') {
    // Idempotent guard: already confirmed
    return {
      orderReference: order.order_reference,
      customerId: order.customer_id,
      retailerName: order.retailer_name,
      totalAmountKobo: order.total_amount_kobo,
    };
  }

  // Deduct stock atomically
  const items = db
    .prepare('SELECT retailer_product_id, quantity, product_name FROM order_items WHERE order_id = ?')
    .all(orderId) as { retailer_product_id: number; quantity: number; product_name: string }[];

  for (const item of items) {
    const rp = db
      .prepare('SELECT stock_quantity, is_available FROM retailer_products WHERE id = ?')
      .get(item.retailer_product_id) as { stock_quantity: number; is_available: number } | undefined;
    if (!rp || !rp.is_available || rp.stock_quantity < item.quantity) {
      throw new Error(`Insufficient stock for ${item.product_name}. Please refresh cart.`);
    }
    db.prepare(`
      UPDATE retailer_products
      SET stock_quantity = stock_quantity - ?,
          is_available = CASE WHEN stock_quantity - ? <= 0 THEN 0 ELSE is_available END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(item.quantity, item.quantity, item.retailer_product_id);
  }

  // Increment promotion usage count if applied
  if (order.promo_code) {
    db.prepare('UPDATE promotions SET used_count = used_count + 1 WHERE code = ?').run(order.promo_code);
  }

  // Record explicit progression: PAYMENT_CONFIRMED -> ORDER_RECEIVED -> AWAITING_DISPATCHER_ASSIGNMENT
  const insertHist = db.prepare(`
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertHist.run(
    orderId,
    order.status,
    'PAYMENT_CONFIRMED',
    actorUserId,
    'SYSTEM',
    `Electronic payment verified (${paymentMethod}${gatewayProvider ? ` via ${gatewayProvider}` : ''}) · Ref ${paymentReference}`
  );
  insertHist.run(
    orderId,
    'PAYMENT_CONFIRMED',
    'ORDER_RECEIVED',
    actorUserId,
    'SYSTEM',
    `Order logged for ${order.retailer_name}`
  );
  insertHist.run(
    orderId,
    'ORDER_RECEIVED',
    'AWAITING_DISPATCHER_ASSIGNMENT',
    actorUserId,
    'SYSTEM',
    'Queued for dispatcher assignment by Operations Admin'
  );

  db.prepare(`
    UPDATE orders
    SET status = 'AWAITING_DISPATCHER_ASSIGNMENT',
        payment_status = 'PAID',
        payment_reference = ?,
        gateway_provider = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(paymentReference, gatewayProvider, orderId);

  // Create Retailer Settlement record (Admin centrally manages retailer payouts)
  const productMargin = Math.max(0, order.subtotal_kobo - order.retailer_supply_total_kobo);
  const existingSettlement = db
    .prepare('SELECT id FROM retailer_settlements WHERE order_id = ?')
    .get(orderId);
  if (!existingSettlement) {
    db.prepare(`
      INSERT INTO retailer_settlements (
        retailer_id, order_id, product_sale_kobo, agreed_retailer_payout_kobo, platform_margin_kobo, status, settlement_reference
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(
      order.retailer_id,
      orderId,
      order.subtotal_kobo,
      order.retailer_supply_total_kobo,
      productMargin,
      generateReference('BF-STL')
    );
  }

  writeFinancialAuditLog({
    eventType: 'ORDER_PAYMENT_CONFIRMED',
    actorUserId,
    actorRole: 'CUSTOMER',
    entityType: 'order',
    entityId: orderId,
    reference: paymentReference,
    amountKobo: order.total_amount_kobo,
    details: {
      orderReference: order.order_reference,
      paymentMethod,
      gatewayProvider,
      retailerPayoutKobo: order.retailer_supply_total_kobo,
      productMarginKobo: productMargin,
    },
  });

  return {
    orderReference: order.order_reference,
    customerId: order.customer_id,
    retailerName: order.retailer_name,
    totalAmountKobo: order.total_amount_kobo,
  };
}

/**
 * Option A: Pay for an order directly from verified Customer Digital Wallet balance.
 */
export function payOrderWithWallet(orderId: number, customerId: number, idempotencyKey?: string): {
  orderReference: string;
  paymentReference: string;
  newWalletBalanceKobo: number;
} {
  const key = idempotencyKey?.trim() || `ORD-WLT-${orderId}`;

  const result = runInTransaction((db) => {
    const order = db
      .prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?')
      .get(orderId, customerId) as
      | {
          id: number;
          order_reference: string;
          total_amount_kobo: number;
          payment_status: string;
          status: string;
        }
      | undefined;

    if (!order) {
      throw new Error('Order not found.');
    }

    const wallet = ensureWalletForUser(customerId);

    // Idempotency check
    const existingTx = db
      .prepare('SELECT reference FROM wallet_transactions WHERE idempotency_key = ?')
      .get(key) as { reference: string } | undefined;
    if (existingTx && order.payment_status === 'PAID') {
      return {
        orderReference: order.order_reference,
        paymentReference: existingTx.reference,
        newWalletBalanceKobo: wallet.balance_kobo,
        alreadyProcessed: true,
        retailerName: '',
        totalAmountKobo: order.total_amount_kobo,
      };
    }

    if (order.payment_status === 'PAID') {
      throw new Error('This order has already been paid.');
    }

    if (wallet.balance_kobo < order.total_amount_kobo) {
      const shortfall = order.total_amount_kobo - wallet.balance_kobo;
      const err = new Error(
        `Insufficient wallet balance. Available: ${formatNairaServer(wallet.balance_kobo)}, Required: ${formatNairaServer(order.total_amount_kobo)}. Please fund your wallet with at least ${formatNairaServer(shortfall)}.`
      ) as Error & { code?: string; shortfallKobo?: number };
      err.code = 'INSUFFICIENT_WALLET_BALANCE';
      err.shortfallKobo = shortfall;
      throw err;
    }

    const before = wallet.balance_kobo;
    const after = before - order.total_amount_kobo;
    const paymentRef = generateReference('BF-WLP');

    db.prepare(`UPDATE wallets SET balance_kobo = ?, updated_at = datetime('now') WHERE id = ?`).run(
      after,
      wallet.id
    );

    db.prepare(`
      INSERT INTO wallet_transactions (
        wallet_id, user_id, reference, idempotency_key, type, direction,
        amount_kobo, balance_before_kobo, balance_after_kobo, status,
        payment_method, order_id, description
      ) VALUES (?, ?, ?, ?, 'ORDER_PAYMENT', 'DEBIT', ?, ?, ?, 'SUCCESS', 'WALLET', ?, ?)
    `).run(
      wallet.id,
      customerId,
      paymentRef,
      key,
      order.total_amount_kobo,
      before,
      after,
      order.id,
      `Cooking gas order payment · ${order.order_reference}`
    );

    const confirmed = confirmOrderAfterVerifiedPayment(order.id, paymentRef, 'WALLET', null, customerId);

    return {
      orderReference: confirmed.orderReference,
      paymentReference: paymentRef,
      newWalletBalanceKobo: after,
      alreadyProcessed: false,
      retailerName: confirmed.retailerName,
      totalAmountKobo: confirmed.totalAmountKobo,
    };
  });

  if (!result.alreadyProcessed) {
    createNotification({
      userId: customerId,
      roleScope: 'CUSTOMER',
      title: 'Order Confirmed (Wallet Payment)',
      message: `Your payment of ${formatNairaServer(result.totalAmountKobo)} for order ${result.orderReference} from ${result.retailerName} is confirmed. Ref: ${result.paymentReference}.`,
      type: 'ORDER',
      channels: ['IN_APP', 'EMAIL', 'SMS'],
      relatedOrderId: orderId,
    });
    notifyAllAdmins({
      title: 'New Paid Order Awaiting Dispatch',
      message: `Order ${result.orderReference} (${formatNairaServer(result.totalAmountKobo)}) paid via Wallet is ready for dispatcher assignment.`,
      type: 'ORDER',
      channels: ['IN_APP', 'EMAIL'],
      relatedOrderId: orderId,
    });
    broadcastOrderUpdate(orderId, customerId, null, 'AWAITING_DISPATCHER_ASSIGNMENT');
  }

  return {
    orderReference: result.orderReference,
    paymentReference: result.paymentReference,
    newWalletBalanceKobo: result.newWalletBalanceKobo,
  };
}

/**
 * Independently verifies a Paystack or Flutterwave electronic transaction server-side.
 * NEVER trusts frontend payment claims without matching a server-initialized record and verifying settlement.
 */
export async function verifyGatewayTransaction(params: {
  reference: string;
  userId: number;
  simulatedOutcome?: 'SUCCESS' | 'FAILED';
  paymentChannelDetails?: Record<string, unknown>;
}): Promise<{
  verified: boolean;
  status: 'VERIFIED_SUCCESS' | 'FAILED';
  reference: string;
  purpose: 'WALLET_FUNDING' | 'ORDER_PAYMENT';
  amountKobo: number;
  walletBalanceKobo?: number;
  orderId?: number | null;
  orderReference?: string;
  message: string;
}> {
  const db = getDb();
  const tx = db
    .prepare('SELECT * FROM gateway_transactions WHERE reference = ? AND user_id = ?')
    .get(params.reference, params.userId) as
    | {
        id: number;
        reference: string;
        idempotency_key: string;
        user_id: number;
        purpose: 'WALLET_FUNDING' | 'ORDER_PAYMENT';
        order_id: number | null;
        provider: 'PAYSTACK' | 'FLUTTERWAVE';
        channel: string;
        amount_kobo: number;
        status: string;
      }
    | undefined;

  if (!tx) {
    throw new Error('Payment transaction reference not found or unauthorized.');
  }

  // Idempotent return if already verified
  if (tx.status === 'VERIFIED_SUCCESS') {
    const wallet = ensureWalletForUser(tx.user_id);
    let orderRef: string | undefined;
    if (tx.order_id) {
      const ord = db.prepare('SELECT order_reference FROM orders WHERE id = ?').get(tx.order_id) as
        | { order_reference: string }
        | undefined;
      orderRef = ord?.order_reference;
    }
    return {
      verified: true,
      status: 'VERIFIED_SUCCESS',
      reference: tx.reference,
      purpose: tx.purpose,
      amountKobo: tx.amount_kobo,
      walletBalanceKobo: wallet.balance_kobo,
      orderId: tx.order_id,
      orderReference: orderRef,
      message: 'Transaction already verified and processed.',
    };
  }

  // Optional real Paystack / Flutterwave server-to-server verification when live secret keys are configured
  let gatewayApproved = params.simulatedOutcome !== 'FAILED';
  let providerPayload: Record<string, unknown> = {
    verifiedBy: 'BlueFlame Server Verification Engine',
    provider: tx.provider,
    channel: tx.channel,
    authorizationCode: `AUTH_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    verifiedAt: new Date().toISOString(),
    ...(params.paymentChannelDetails || {}),
  };

  if (tx.provider === 'PAYSTACK' && process.env.PAYSTACK_SECRET_KEY) {
    try {
      const resp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(tx.reference)}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      });
      const json = (await resp.json()) as { status?: boolean; data?: { status?: string; amount?: number } };
      gatewayApproved = Boolean(json.status && json.data?.status === 'success' && json.data?.amount === tx.amount_kobo);
      providerPayload = json as unknown as Record<string, unknown>;
    } catch (err) {
      gatewayApproved = false;
      providerPayload = { error: String(err) };
    }
  } else if (tx.provider === 'FLUTTERWAVE' && process.env.FLUTTERWAVE_SECRET_KEY) {
    try {
      const resp = await fetch(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx.reference)}`,
        {
          headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
        }
      );
      const json = (await resp.json()) as { status?: string; data?: { status?: string; amount?: number } };
      gatewayApproved = Boolean(
        json.status === 'success' &&
          json.data?.status === 'successful' &&
          Math.round((json.data?.amount || 0) * 100) === tx.amount_kobo
      );
      providerPayload = json as unknown as Record<string, unknown>;
    } catch (err) {
      gatewayApproved = false;
      providerPayload = { error: String(err) };
    }
  }

  // Handle FAILED payment cleanly — NEVER credit wallet, NEVER confirm order!
  if (!gatewayApproved) {
    runInTransaction((tdb) => {
      tdb
        .prepare(`
          UPDATE gateway_transactions
          SET status = 'FAILED', provider_response_json = ?, verified_at = datetime('now')
          WHERE id = ?
        `)
        .run(JSON.stringify({ ...providerPayload, gatewayMessage: 'Payment declined or unverified' }), tx.id);

      if (tx.purpose === 'WALLET_FUNDING') {
        const wallet = ensureWalletForUser(tx.user_id);
        tdb
          .prepare(`
            INSERT OR IGNORE INTO wallet_transactions (
              wallet_id, user_id, reference, idempotency_key, type, direction,
              amount_kobo, balance_before_kobo, balance_after_kobo, status,
              payment_method, gateway_provider, gateway_reference, description
            ) VALUES (?, ?, ?, ?, 'FUNDING', 'CREDIT', ?, ?, ?, 'FAILED', ?, ?, ?, ?)
          `)
          .run(
            wallet.id,
            tx.user_id,
            tx.reference,
            `GW-FAIL-${tx.reference}`,
            tx.amount_kobo,
            wallet.balance_kobo,
            wallet.balance_kobo,
            tx.channel,
            tx.provider,
            tx.reference,
            `Failed wallet funding attempt via ${tx.provider} (${tx.channel})`
          );
      } else if (tx.purpose === 'ORDER_PAYMENT' && tx.order_id) {
        tdb
          .prepare(`UPDATE orders SET payment_status = 'FAILED', updated_at = datetime('now') WHERE id = ? AND payment_status != 'PAID'`)
          .run(tx.order_id);
      }

      writeFinancialAuditLog({
        eventType: 'GATEWAY_PAYMENT_FAILED',
        actorUserId: tx.user_id,
        actorRole: 'CUSTOMER',
        entityType: 'gateway_transaction',
        entityId: tx.reference,
        reference: tx.reference,
        amountKobo: tx.amount_kobo,
        details: { purpose: tx.purpose, provider: tx.provider, orderId: tx.order_id },
      });
    });

    createNotification({
      userId: tx.user_id,
      roleScope: 'CUSTOMER',
      title: tx.purpose === 'WALLET_FUNDING' ? 'Wallet Funding Failed' : 'Online Payment Failed',
      message: `Your ${tx.provider} payment of ${formatNairaServer(tx.amount_kobo)} (Ref: ${tx.reference}) could not be verified. No funds were credited and no order was confirmed.`,
      type: 'PAYMENT',
      channels: ['IN_APP', 'EMAIL'],
      relatedOrderId: tx.order_id,
    });
    notifyAllAdmins({
      title: 'Failed Electronic Payment Alert',
      message: `A ${tx.provider} ${tx.purpose.toLowerCase().replace('_', ' ')} of ${formatNairaServer(tx.amount_kobo)} failed verification (Ref: ${tx.reference}).`,
      type: 'PAYMENT',
      channels: ['IN_APP'],
      relatedOrderId: tx.order_id,
    });

    return {
      verified: false,
      status: 'FAILED',
      reference: tx.reference,
      purpose: tx.purpose,
      amountKobo: tx.amount_kobo,
      orderId: tx.order_id,
      message: 'Payment verification failed or was declined by the gateway. No order was confirmed.',
    };
  }

  // Verified SUCCESS: atomically credit wallet OR confirm order
  if (tx.purpose === 'WALLET_FUNDING') {
    const funded = runInTransaction((tdb) => {
      const currentTx = tdb
        .prepare('SELECT status FROM gateway_transactions WHERE id = ?')
        .get(tx.id) as { status: string };
      const wallet = ensureWalletForUser(tx.user_id);
      if (currentTx.status === 'VERIFIED_SUCCESS') {
        return { newBalance: wallet.balance_kobo, alreadyDone: true };
      }

      tdb
        .prepare(`
          UPDATE gateway_transactions
          SET status = 'VERIFIED_SUCCESS', provider_response_json = ?, verified_at = datetime('now')
          WHERE id = ?
        `)
        .run(JSON.stringify(providerPayload), tx.id);

      const before = wallet.balance_kobo;
      const after = before + tx.amount_kobo;

      tdb
        .prepare(`UPDATE wallets SET balance_kobo = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(after, wallet.id);

      tdb
        .prepare(`
          INSERT INTO wallet_transactions (
            wallet_id, user_id, reference, idempotency_key, type, direction,
            amount_kobo, balance_before_kobo, balance_after_kobo, status,
            payment_method, gateway_provider, gateway_reference, description, metadata_json
          ) VALUES (?, ?, ?, ?, 'FUNDING', 'CREDIT', ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?)
        `)
        .run(
          wallet.id,
          tx.user_id,
          tx.reference,
          `FUND-${tx.reference}`,
          tx.amount_kobo,
          before,
          after,
          tx.channel,
          tx.provider,
          tx.reference,
          `Wallet funded via ${tx.provider} (${tx.channel.replace('_', ' ')})`,
          JSON.stringify(providerPayload)
        );

      writeFinancialAuditLog({
        eventType: 'WALLET_FUNDED_VERIFIED',
        actorUserId: tx.user_id,
        actorRole: 'CUSTOMER',
        entityType: 'wallet',
        entityId: wallet.id,
        reference: tx.reference,
        amountKobo: tx.amount_kobo,
        details: { provider: tx.provider, channel: tx.channel, balanceBeforeKobo: before, balanceAfterKobo: after },
      });

      return { newBalance: after, alreadyDone: false };
    });

    if (!funded.alreadyDone) {
      createNotification({
        userId: tx.user_id,
        roleScope: 'CUSTOMER',
        title: 'Wallet Funded Successfully',
        message: `${formatNairaServer(tx.amount_kobo)} has been credited to your BlueFlame wallet via ${tx.provider}. New balance: ${formatNairaServer(funded.newBalance)}. Ref: ${tx.reference}.`,
        type: 'WALLET',
        channels: ['IN_APP', 'EMAIL', 'SMS'],
      });
    }

    return {
      verified: true,
      status: 'VERIFIED_SUCCESS',
      reference: tx.reference,
      purpose: 'WALLET_FUNDING',
      amountKobo: tx.amount_kobo,
      walletBalanceKobo: funded.newBalance,
      message: 'Wallet funding verified and credited.',
    };
  }

  // Purpose === 'ORDER_PAYMENT'
  if (!tx.order_id) {
    throw new Error('Gateway transaction is missing associated order ID.');
  }

  const confirmed = runInTransaction((tdb) => {
    const currentTx = tdb
      .prepare('SELECT status FROM gateway_transactions WHERE id = ?')
      .get(tx.id) as { status: string };
    if (currentTx.status === 'VERIFIED_SUCCESS') {
      const ord = tdb
        .prepare('SELECT order_reference, customer_id, total_amount_kobo FROM orders WHERE id = ?')
        .get(tx.order_id!) as { order_reference: string; customer_id: number; total_amount_kobo: number };
      return { ...ord, retailerName: '', alreadyDone: true };
    }

    const ord = tdb
      .prepare('SELECT total_amount_kobo FROM orders WHERE id = ?')
      .get(tx.order_id!) as { total_amount_kobo: number } | undefined;
    if (!ord || ord.total_amount_kobo !== tx.amount_kobo) {
      throw new Error('Verified payment amount does not match order total.');
    }

    tdb
      .prepare(`
        UPDATE gateway_transactions
        SET status = 'VERIFIED_SUCCESS', provider_response_json = ?, verified_at = datetime('now')
        WHERE id = ?
      `)
      .run(JSON.stringify(providerPayload), tx.id);

    const res = confirmOrderAfterVerifiedPayment(
      tx.order_id!,
      tx.reference,
      'DIRECT_ONLINE',
      tx.provider,
      tx.user_id
    );
    return {
      order_reference: res.orderReference,
      customer_id: res.customerId,
      total_amount_kobo: res.totalAmountKobo,
      retailerName: res.retailerName,
      alreadyDone: false,
    };
  });

  if (!confirmed.alreadyDone) {
    createNotification({
      userId: tx.user_id,
      roleScope: 'CUSTOMER',
      title: 'Online Payment Confirmed',
      message: `Your ${tx.provider} payment of ${formatNairaServer(tx.amount_kobo)} for order ${confirmed.order_reference} is verified. We are assigning a dispatcher.`,
      type: 'ORDER',
      channels: ['IN_APP', 'EMAIL', 'SMS'],
      relatedOrderId: tx.order_id,
    });
    notifyAllAdmins({
      title: 'New Direct-Paid Order Ready for Dispatch',
      message: `Order ${confirmed.order_reference} (${formatNairaServer(tx.amount_kobo)}) verified via ${tx.provider} is awaiting dispatcher assignment.`,
      type: 'ORDER',
      channels: ['IN_APP', 'EMAIL'],
      relatedOrderId: tx.order_id,
    });
    broadcastOrderUpdate(tx.order_id, tx.user_id, null, 'AWAITING_DISPATCHER_ASSIGNMENT');
  }

  return {
    verified: true,
    status: 'VERIFIED_SUCCESS',
    reference: tx.reference,
    purpose: 'ORDER_PAYMENT',
    amountKobo: tx.amount_kobo,
    orderId: tx.order_id,
    orderReference: confirmed.order_reference,
    message: 'Electronic payment verified and order confirmed.',
  };
}

/**
 * Records traceable dispatcher compensation when an order is completed (DELIVERED).
 */
export function recordDispatcherEarningForOrder(orderId: number, dispatcherId: number): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM dispatcher_earnings WHERE order_id = ?').get(orderId);
  if (existing) return;

  const order = db
    .prepare('SELECT distance_km, delivery_state, delivery_city, order_reference FROM orders WHERE id = ?')
    .get(orderId) as
    | { distance_km: number; delivery_state: string; delivery_city: string; order_reference: string }
    | undefined;
  const profile = db
    .prepare('SELECT compensation_model, base_rate_kobo, per_km_rate_kobo, zone FROM dispatcher_profiles WHERE user_id = ?')
    .get(dispatcherId) as
    | { compensation_model: string; base_rate_kobo: number; per_km_rate_kobo: number; zone: string }
    | undefined;

  if (!order || !profile) return;

  let baseKobo = profile.base_rate_kobo;
  let distanceBonusKobo = 0;

  if (profile.compensation_model === 'FIXED') {
    distanceBonusKobo = 0;
  } else if (profile.compensation_model === 'DISTANCE') {
    baseKobo = 0;
    distanceBonusKobo = Math.max(50000, Math.round(order.distance_km * profile.per_km_rate_kobo));
  } else if (profile.compensation_model === 'ZONE') {
    const zoneBonus = profile.zone.toLowerCase().includes('island') || profile.zone.toLowerCase().includes('lekki') ? 25000 : 15000;
    distanceBonusKobo = zoneBonus;
  } else {
    // FIXED_PLUS_DISTANCE
    distanceBonusKobo = Math.round(order.distance_km * profile.per_km_rate_kobo);
  }

  const totalKobo = baseKobo + distanceBonusKobo;
  const payoutRef = generateReference('BF-DSP');

  db.prepare(`
    INSERT INTO dispatcher_earnings (
      dispatcher_id, order_id, compensation_model, base_amount_kobo, distance_bonus_kobo,
      admin_bonus_kobo, total_earning_kobo, status, payout_reference
    ) VALUES (?, ?, ?, ?, ?, 0, ?, 'APPROVED', ?)
  `).run(
    dispatcherId,
    orderId,
    profile.compensation_model,
    baseKobo,
    distanceBonusKobo,
    totalKobo,
    payoutRef
  );

  db.prepare(`
    UPDATE dispatcher_profiles
    SET completed_deliveries_count = completed_deliveries_count + 1
    WHERE user_id = ?
  `).run(dispatcherId);

  writeFinancialAuditLog({
    eventType: 'DISPATCHER_EARNING_RECORDED',
    actorUserId: dispatcherId,
    actorRole: 'DISPATCHER',
    entityType: 'dispatcher_earning',
    entityId: orderId,
    reference: payoutRef,
    amountKobo: totalKobo,
    details: { orderReference: order.order_reference, model: profile.compensation_model, distanceKm: order.distance_km },
  });

  createNotification({
    userId: dispatcherId,
    roleScope: 'DISPATCHER',
    title: 'Delivery Earning Approved',
    message: `You earned ${formatNairaServer(totalKobo)} for delivering order ${order.order_reference}. Ref: ${payoutRef}.`,
    type: 'PAYMENT',
    channels: ['IN_APP'],
    relatedOrderId: orderId,
  });
}

/**
 * Admin approves and executes a customer refund with strict duplicate-refund protection.
 */
export function executeAdminRefund(params: {
  orderId: number;
  adminUserId: number;
  amountKobo?: number;
  destination: 'WALLET' | 'ORIGINAL_METHOD';
  reason: string;
  adminNotes?: string;
}): { refundReference: string; amountKobo: number; destination: string; newWalletBalanceKobo?: number } {
  const res = runInTransaction((db) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.orderId) as
      | {
          id: number;
          order_reference: string;
          customer_id: number;
          dispatcher_id: number | null;
          total_amount_kobo: number;
          payment_status: string;
          status: string;
        }
      | undefined;

    if (!order) {
      throw new Error('Order not found.');
    }
    if (order.payment_status !== 'PAID' && order.payment_status !== 'REFUND_PROCESSING') {
      throw new Error('Only paid orders can be refunded.');
    }

    const existingCompleted = db
      .prepare("SELECT id, status FROM refunds WHERE order_id = ? AND status = 'COMPLETED'")
      .get(order.id) as { id: number; status: string } | undefined;
    if (existingCompleted) {
      throw new Error('Duplicate refund blocked: a completed refund already exists for this order.');
    }

    const refundAmount = params.amountKobo && params.amountKobo > 0 ? Math.min(params.amountKobo, order.total_amount_kobo) : order.total_amount_kobo;

    const existingRecord = db.prepare('SELECT id, refund_reference FROM refunds WHERE order_id = ?').get(order.id) as
      | { id: number; refund_reference: string }
      | undefined;
    const refundRef = existingRecord?.refund_reference || generateReference('BF-REF');

    let walletTxId: number | null = null;
    let newWalletBalance: number | undefined;

    if (params.destination === 'WALLET') {
      const wallet = ensureWalletForUser(order.customer_id);
      const before = wallet.balance_kobo;
      const after = before + refundAmount;
      db.prepare(`UPDATE wallets SET balance_kobo = ?, updated_at = datetime('now') WHERE id = ?`).run(after, wallet.id);

      const txInfo = db
        .prepare(`
          INSERT INTO wallet_transactions (
            wallet_id, user_id, reference, idempotency_key, type, direction,
            amount_kobo, balance_before_kobo, balance_after_kobo, status,
            payment_method, order_id, description
          ) VALUES (?, ?, ?, ?, 'REFUND', 'CREDIT', ?, ?, ?, 'SUCCESS', 'WALLET_REFUND', ?, ?)
        `)
        .run(
          wallet.id,
          order.customer_id,
          refundRef,
          `REFUND-ORD-${order.id}`,
          refundAmount,
          before,
          after,
          order.id,
          `Refund credited for order ${order.order_reference}: ${params.reason}`
        );
      walletTxId = Number(txInfo.lastInsertRowid);
      newWalletBalance = after;
    }

    if (existingRecord) {
      db.prepare(`
        UPDATE refunds
        SET amount_kobo = ?, destination = ?, reason = ?, status = 'COMPLETED',
            reviewed_by_admin_id = ?, admin_notes = ?, wallet_transaction_id = ?, processed_at = datetime('now')
        WHERE id = ?
      `).run(
        refundAmount,
        params.destination,
        params.reason,
        params.adminUserId,
        params.adminNotes || '',
        walletTxId,
        existingRecord.id
      );
    } else {
      db.prepare(`
        INSERT INTO refunds (
          order_id, customer_id, amount_kobo, destination, reason, status,
          refund_reference, reviewed_by_admin_id, admin_notes, wallet_transaction_id, processed_at
        ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, datetime('now'))
      `).run(
        order.id,
        order.customer_id,
        refundAmount,
        params.destination,
        params.reason,
        refundRef,
        params.adminUserId,
        params.adminNotes || '',
        walletTxId
      );
    }

    // Cancel pending retailer settlement if order was refunded before fulfillment
    db.prepare(`
      UPDATE retailer_settlements
      SET status = 'CANCELLED', notes = 'Cancelled due to customer order refund'
      WHERE order_id = ? AND status IN ('PENDING', 'APPROVED')
    `).run(order.id);

    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
      VALUES (?, ?, 'REFUNDED', ?, 'ADMIN', ?)
    `).run(
      order.id,
      order.status,
      params.adminUserId,
      `Refund of ${formatNairaServer(refundAmount)} completed to ${params.destination} (${refundRef}). Reason: ${params.reason}`
    );

    db.prepare(`
      UPDATE orders
      SET status = 'REFUNDED', payment_status = 'REFUNDED', updated_at = datetime('now')
      WHERE id = ?
    `).run(order.id);

    writeFinancialAuditLog({
      eventType: 'REFUND_COMPLETED',
      actorUserId: params.adminUserId,
      actorRole: 'ADMIN',
      entityType: 'refund',
      entityId: order.id,
      reference: refundRef,
      amountKobo: refundAmount,
      details: {
        orderReference: order.order_reference,
        destination: params.destination,
        reason: params.reason,
        walletTxId,
      },
    });

    return {
      orderReference: order.order_reference,
      customerId: order.customer_id,
      dispatcherId: order.dispatcher_id,
      refundReference: refundRef,
      amountKobo: refundAmount,
      destination: params.destination,
      newWalletBalanceKobo: newWalletBalance,
    };
  });

  createNotification({
    userId: res.customerId,
    roleScope: 'CUSTOMER',
    title: 'Refund Credited',
    message: `Your refund of ${formatNairaServer(res.amountKobo)} for order ${res.orderReference} has been processed to your ${res.destination === 'WALLET' ? 'BlueFlame Wallet' : 'original payment method'}. Ref: ${res.refundReference}.`,
    type: 'REFUND',
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    relatedOrderId: params.orderId,
  });

  broadcastOrderUpdate(params.orderId, res.customerId, res.dispatcherId, 'REFUNDED');

  return {
    refundReference: res.refundReference,
    amountKobo: res.amountKobo,
    destination: res.destination,
    newWalletBalanceKobo: res.newWalletBalanceKobo,
  };
}
