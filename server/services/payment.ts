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

export async function writeFinancialAuditLog(params: {
  eventType: string;
  actorUserId?: number | null;
  actorRole: UserRole | 'SYSTEM';
  entityType: string;
  entityId: string | number;
  reference: string;
  amountKobo: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.run(
    `
    INSERT INTO financial_audit_logs (
      event_type, actor_user_id, actor_role, entity_type, entity_id, reference, amount_kobo, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
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

export async function ensureWalletForUser(userId: number): Promise<{ id: number; user_id: number; balance_kobo: number }> {
  const db = getDb();
  let wallet = await db.get<{ id: number; user_id: number; balance_kobo: number }>(
    'SELECT id, user_id, balance_kobo FROM wallets WHERE user_id = ?',
    userId
  );
  if (!wallet) {
    await db.run('INSERT OR IGNORE INTO wallets (user_id, balance_kobo) VALUES (?, 0)', userId);
    wallet = (await db.get<{ id: number; user_id: number; balance_kobo: number }>(
      'SELECT id, user_id, balance_kobo FROM wallets WHERE user_id = ?',
      userId
    ))!;
  }
  return {
    id: Number(wallet.id),
    user_id: Number(wallet.user_id),
    balance_kobo: Number(wallet.balance_kobo),
  };
}

export async function getPlatformSettings(): Promise<Record<string, unknown>> {
  const db = getDb();
  const rows = await db.all<{ key: string; value_json: string }>('SELECT key, value_json FROM platform_settings');
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

export async function initializeGatewayTransaction(params: {
  userId: number;
  purpose: 'WALLET_FUNDING' | 'ORDER_PAYMENT';
  orderId?: number | null;
  provider: 'PAYSTACK' | 'FLUTTERWAVE';
  channel: 'CARD' | 'BANK_TRANSFER' | 'USSD';
  amountKobo: number;
  idempotencyKey?: string;
}): Promise<{
  reference: string;
  idempotencyKey: string;
  provider: string;
  channel: string;
  amountKobo: number;
  status: string;
  mode: 'LIVE' | 'SANDBOX_VERIFIED';
}> {
  const db = getDb();
  const idempotencyKey = params.idempotencyKey?.trim() || `IDEMP-${crypto.randomUUID()}`;

  const existing = await db.get<{
    reference: string;
    idempotency_key: string;
    provider: string;
    channel: string;
    amount_kobo: number;
    status: string;
  }>('SELECT * FROM gateway_transactions WHERE idempotency_key = ?', idempotencyKey);

  if (existing) {
    return {
      reference: existing.reference,
      idempotencyKey: existing.idempotency_key,
      provider: existing.provider,
      channel: existing.channel,
      amountKobo: Number(existing.amount_kobo),
      status: existing.status,
      mode: process.env.PAYSTACK_SECRET_KEY || process.env.FLUTTERWAVE_SECRET_KEY ? 'LIVE' : 'SANDBOX_VERIFIED',
    };
  }

  const prefix = params.purpose === 'WALLET_FUNDING' ? 'BF-WLT' : 'BF-PAY';
  const reference = generateReference(prefix);

  await db.run(
    `
    INSERT INTO gateway_transactions (
      reference, idempotency_key, user_id, purpose, order_id, provider, channel, amount_kobo, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `,
    reference,
    idempotencyKey,
    params.userId,
    params.purpose,
    params.orderId ?? null,
    params.provider,
    params.channel,
    params.amountKobo
  );

  await writeFinancialAuditLog({
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

async function confirmOrderAfterVerifiedPayment(
  orderId: number,
  paymentReference: string,
  paymentMethod: 'WALLET' | 'DIRECT_ONLINE',
  gatewayProvider: string | null,
  actorUserId: number
): Promise<{ orderReference: string; customerId: number; retailerName: string; totalAmountKobo: number }> {
  const db = getDb();
  const order = await db.get<{
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
  }>(
    `
    SELECT o.*, r.business_name as retailer_name
    FROM orders o
    JOIN retailers r ON r.id = o.retailer_id
    WHERE o.id = ?
  `,
    orderId
  );

  if (!order) {
    throw new Error('Order not found for confirmation.');
  }

  if (order.payment_status === 'PAID') {
    return {
      orderReference: order.order_reference,
      customerId: Number(order.customer_id),
      retailerName: order.retailer_name,
      totalAmountKobo: Number(order.total_amount_kobo),
    };
  }

  const items = await db.all<{ retailer_product_id: number; quantity: number; product_name: string }>(
    'SELECT retailer_product_id, quantity, product_name FROM order_items WHERE order_id = ?',
    orderId
  );

  for (const item of items) {
    const upd = await db.run(
      `
      UPDATE retailer_products
      SET stock_quantity = stock_quantity - ?,
          is_available = CASE WHEN stock_quantity - ? <= 0 THEN 0 ELSE is_available END,
          updated_at = datetime('now')
      WHERE id = ? AND is_available = 1 AND stock_quantity >= ?
    `,
      item.quantity,
      item.quantity,
      item.retailer_product_id,
      item.quantity
    );
    if (upd.changes === 0) {
      throw new Error(`Insufficient stock for ${item.product_name}. Please refresh cart.`);
    }
  }

  if (order.promo_code) {
    await db.run('UPDATE promotions SET used_count = used_count + 1 WHERE LOWER(code) = LOWER(?)', order.promo_code);
  }

  const histSql = `
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  await db.run(
    histSql,
    orderId,
    order.status,
    'PAYMENT_CONFIRMED',
    actorUserId,
    'SYSTEM',
    `Electronic payment verified (${paymentMethod}${gatewayProvider ? ` via ${gatewayProvider}` : ''}) · Ref ${paymentReference}`
  );
  await db.run(histSql, orderId, 'PAYMENT_CONFIRMED', 'ORDER_RECEIVED', actorUserId, 'SYSTEM', `Order logged for ${order.retailer_name}`);
  await db.run(histSql, orderId, 'ORDER_RECEIVED', 'AWAITING_DISPATCHER_ASSIGNMENT', actorUserId, 'SYSTEM', 'Queued for dispatcher assignment by Operations Admin');

  await db.run(
    `
    UPDATE orders
    SET status = 'AWAITING_DISPATCHER_ASSIGNMENT',
        payment_status = 'PAID',
        payment_reference = ?,
        gateway_provider = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `,
    paymentReference,
    gatewayProvider,
    orderId
  );

  const productMargin = Math.max(0, Number(order.subtotal_kobo) - Number(order.retailer_supply_total_kobo));
  const existingSettlement = await db.get<{ id: number }>(
    'SELECT id FROM retailer_settlements WHERE order_id = ?',
    orderId
  );
  if (!existingSettlement) {
    await db.run(
      `
      INSERT INTO retailer_settlements (
        retailer_id, order_id, product_sale_kobo, agreed_retailer_payout_kobo, platform_margin_kobo, status, settlement_reference
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
    `,
      order.retailer_id,
      orderId,
      order.subtotal_kobo,
      order.retailer_supply_total_kobo,
      productMargin,
      generateReference('BF-STL')
    );
  }

  await writeFinancialAuditLog({
    eventType: 'ORDER_PAYMENT_CONFIRMED',
    actorUserId,
    actorRole: 'CUSTOMER',
    entityType: 'order',
    entityId: orderId,
    reference: paymentReference,
    amountKobo: Number(order.total_amount_kobo),
    details: {
      orderReference: order.order_reference,
      paymentMethod,
      gatewayProvider,
      retailerPayoutKobo: Number(order.retailer_supply_total_kobo),
      productMarginKobo: productMargin,
    },
  });

  return {
    orderReference: order.order_reference,
    customerId: Number(order.customer_id),
    retailerName: order.retailer_name,
    totalAmountKobo: Number(order.total_amount_kobo),
  };
}

export async function payOrderWithWallet(
  orderId: number,
  customerId: number,
  idempotencyKey?: string
): Promise<{
  orderReference: string;
  paymentReference: string;
  newWalletBalanceKobo: number;
}> {
  const key = idempotencyKey?.trim() || `ORD-WLT-${orderId}`;

  const result = await runInTransaction(async (db) => {
    const order = await db.get<{
      id: number;
      order_reference: string;
      total_amount_kobo: number;
      payment_status: string;
      status: string;
    }>('SELECT * FROM orders WHERE id = ? AND customer_id = ?', orderId, customerId);

    if (!order) {
      throw new Error('Order not found.');
    }

    const totalKobo = Number(order.total_amount_kobo);
    const wallet = await ensureWalletForUser(customerId);

    const existingTx = await db.get<{ reference: string }>(
      'SELECT reference FROM wallet_transactions WHERE idempotency_key = ?',
      key
    );
    if (existingTx && order.payment_status === 'PAID') {
      return {
        orderReference: order.order_reference,
        paymentReference: existingTx.reference,
        newWalletBalanceKobo: wallet.balance_kobo,
        alreadyProcessed: true,
        retailerName: '',
        totalAmountKobo: totalKobo,
      };
    }

    if (order.payment_status === 'PAID') {
      throw new Error('This order has already been paid.');
    }

    // Atomic conditional debit prevents concurrent double-spend!
    const debit = await db.run(
      `UPDATE wallets SET balance_kobo = balance_kobo - ?, updated_at = datetime('now') WHERE id = ? AND balance_kobo >= ?`,
      totalKobo,
      wallet.id,
      totalKobo
    );
    if (debit.changes === 0) {
      const fresh = await ensureWalletForUser(customerId);
      const shortfall = Math.max(0, totalKobo - fresh.balance_kobo);
      const err = new Error(
        `Insufficient wallet balance. Available: ${formatNairaServer(fresh.balance_kobo)}, Required: ${formatNairaServer(totalKobo)}. Please fund your wallet with at least ${formatNairaServer(shortfall)}.`
      ) as Error & { code?: string; shortfallKobo?: number };
      err.code = 'INSUFFICIENT_WALLET_BALANCE';
      err.shortfallKobo = shortfall;
      throw err;
    }

    const updatedWallet = await ensureWalletForUser(customerId);
    const after = updatedWallet.balance_kobo;
    const before = after + totalKobo;
    const paymentRef = generateReference('BF-WLP');

    await db.run(
      `
      INSERT INTO wallet_transactions (
        wallet_id, user_id, reference, idempotency_key, type, direction,
        amount_kobo, balance_before_kobo, balance_after_kobo, status,
        payment_method, order_id, description
      ) VALUES (?, ?, ?, ?, 'ORDER_PAYMENT', 'DEBIT', ?, ?, ?, 'SUCCESS', 'WALLET', ?, ?)
    `,
      wallet.id,
      customerId,
      paymentRef,
      key,
      totalKobo,
      before,
      after,
      order.id,
      `Cooking gas order payment · ${order.order_reference}`
    );

    const confirmed = await confirmOrderAfterVerifiedPayment(order.id, paymentRef, 'WALLET', null, customerId);

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
    await createNotification({
      userId: customerId,
      roleScope: 'CUSTOMER',
      title: 'Order Confirmed (Wallet Payment)',
      message: `Your payment of ${formatNairaServer(result.totalAmountKobo)} for order ${result.orderReference} from ${result.retailerName} is confirmed. Ref: ${result.paymentReference}.`,
      type: 'ORDER',
      channels: ['IN_APP', 'EMAIL', 'SMS'],
      relatedOrderId: orderId,
    });
    await notifyAllAdmins({
      title: 'New Paid Order Awaiting Dispatch',
      message: `Order ${result.orderReference} (${formatNairaServer(result.totalAmountKobo)}) paid via Wallet is ready for Uyo dispatcher assignment.`,
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
  const tx = await db.get<{
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
  }>('SELECT * FROM gateway_transactions WHERE reference = ? AND user_id = ?', params.reference, params.userId);

  if (!tx) {
    throw new Error('Payment transaction reference not found or unauthorized.');
  }

  const amountKobo = Number(tx.amount_kobo);

  if (tx.status === 'VERIFIED_SUCCESS') {
    const wallet = await ensureWalletForUser(Number(tx.user_id));
    let orderRef: string | undefined;
    if (tx.order_id) {
      const ord = await db.get<{ order_reference: string }>('SELECT order_reference FROM orders WHERE id = ?', tx.order_id);
      orderRef = ord?.order_reference;
    }
    return {
      verified: true,
      status: 'VERIFIED_SUCCESS',
      reference: tx.reference,
      purpose: tx.purpose,
      amountKobo,
      walletBalanceKobo: wallet.balance_kobo,
      orderId: tx.order_id ? Number(tx.order_id) : null,
      orderReference: orderRef,
      message: 'Transaction already verified and processed.',
    };
  }

  let gatewayApproved = params.simulatedOutcome !== 'FAILED';
  let providerPayload: Record<string, unknown> = {
    verifiedBy: 'Gasflo Server Verification Engine',
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
      gatewayApproved = Boolean(json.status && json.data?.status === 'success' && json.data?.amount === amountKobo);
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
          Math.round((json.data?.amount || 0) * 100) === amountKobo
      );
      providerPayload = json as unknown as Record<string, unknown>;
    } catch (err) {
      gatewayApproved = false;
      providerPayload = { error: String(err) };
    }
  }

  if (!gatewayApproved) {
    await runInTransaction(async (tdb) => {
      await tdb.run(
        `UPDATE gateway_transactions SET status = 'FAILED', provider_response_json = ?, verified_at = datetime('now') WHERE id = ?`,
        JSON.stringify({ ...providerPayload, gatewayMessage: 'Payment declined or unverified' }),
        tx.id
      );

      if (tx.purpose === 'WALLET_FUNDING') {
        const wallet = await ensureWalletForUser(Number(tx.user_id));
        await tdb.run(
          `
          INSERT OR IGNORE INTO wallet_transactions (
            wallet_id, user_id, reference, idempotency_key, type, direction,
            amount_kobo, balance_before_kobo, balance_after_kobo, status,
            payment_method, gateway_provider, gateway_reference, description
          ) VALUES (?, ?, ?, ?, 'FUNDING', 'CREDIT', ?, ?, ?, 'FAILED', ?, ?, ?, ?)
        `,
          wallet.id,
          tx.user_id,
          tx.reference,
          `GW-FAIL-${tx.reference}`,
          amountKobo,
          wallet.balance_kobo,
          wallet.balance_kobo,
          tx.channel,
          tx.provider,
          tx.reference,
          `Failed wallet funding attempt via ${tx.provider} (${tx.channel})`
        );
      } else if (tx.purpose === 'ORDER_PAYMENT' && tx.order_id) {
        await tdb.run(
          `UPDATE orders SET payment_status = 'FAILED', updated_at = datetime('now') WHERE id = ? AND payment_status != 'PAID'`,
          tx.order_id
        );
      }

      await writeFinancialAuditLog({
        eventType: 'GATEWAY_PAYMENT_FAILED',
        actorUserId: Number(tx.user_id),
        actorRole: 'CUSTOMER',
        entityType: 'gateway_transaction',
        entityId: tx.reference,
        reference: tx.reference,
        amountKobo,
        details: { purpose: tx.purpose, provider: tx.provider, orderId: tx.order_id },
      });
    });

    await createNotification({
      userId: Number(tx.user_id),
      roleScope: 'CUSTOMER',
      title: tx.purpose === 'WALLET_FUNDING' ? 'Wallet Funding Failed' : 'Online Payment Failed',
      message: `Your ${tx.provider} payment of ${formatNairaServer(amountKobo)} (Ref: ${tx.reference}) could not be verified. No funds were credited and no order was confirmed.`,
      type: 'PAYMENT',
      channels: ['IN_APP', 'EMAIL'],
      relatedOrderId: tx.order_id,
    });
    await notifyAllAdmins({
      title: 'Failed Electronic Payment Alert',
      message: `A ${tx.provider} ${tx.purpose.toLowerCase().replace('_', ' ')} of ${formatNairaServer(amountKobo)} failed verification (Ref: ${tx.reference}).`,
      type: 'PAYMENT',
      channels: ['IN_APP'],
      relatedOrderId: tx.order_id,
    });

    return {
      verified: false,
      status: 'FAILED',
      reference: tx.reference,
      purpose: tx.purpose,
      amountKobo,
      orderId: tx.order_id ? Number(tx.order_id) : null,
      message: 'Payment verification failed or was declined by the gateway. No order was confirmed.',
    };
  }

  if (tx.purpose === 'WALLET_FUNDING') {
    const funded = await runInTransaction(async (tdb) => {
      // Atomic idempotency guard: claim transition to VERIFIED_SUCCESS once
      const claim = await tdb.run(
        `UPDATE gateway_transactions SET status = 'VERIFIED_SUCCESS', provider_response_json = ?, verified_at = datetime('now') WHERE id = ? AND status != 'VERIFIED_SUCCESS'`,
        JSON.stringify(providerPayload),
        tx.id
      );
      const wallet = await ensureWalletForUser(Number(tx.user_id));
      if (claim.changes === 0) {
        return { newBalance: wallet.balance_kobo, alreadyDone: true };
      }

      const before = wallet.balance_kobo;
      const after = before + amountKobo;

      await tdb.run(`UPDATE wallets SET balance_kobo = balance_kobo + ?, updated_at = datetime('now') WHERE id = ?`, amountKobo, wallet.id);

      await tdb.run(
        `
        INSERT INTO wallet_transactions (
          wallet_id, user_id, reference, idempotency_key, type, direction,
          amount_kobo, balance_before_kobo, balance_after_kobo, status,
          payment_method, gateway_provider, gateway_reference, description, metadata_json
        ) VALUES (?, ?, ?, ?, 'FUNDING', 'CREDIT', ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?)
      `,
        wallet.id,
        tx.user_id,
        tx.reference,
        `FUND-${tx.reference}`,
        amountKobo,
        before,
        after,
        tx.channel,
        tx.provider,
        tx.reference,
        `Wallet funded via ${tx.provider} (${tx.channel.replace('_', ' ')})`,
        JSON.stringify(providerPayload)
      );

      await writeFinancialAuditLog({
        eventType: 'WALLET_FUNDED_VERIFIED',
        actorUserId: Number(tx.user_id),
        actorRole: 'CUSTOMER',
        entityType: 'wallet',
        entityId: wallet.id,
        reference: tx.reference,
        amountKobo,
        details: { provider: tx.provider, channel: tx.channel, balanceBeforeKobo: before, balanceAfterKobo: after },
      });

      return { newBalance: after, alreadyDone: false };
    });

    if (!funded.alreadyDone) {
      await createNotification({
        userId: Number(tx.user_id),
        roleScope: 'CUSTOMER',
        title: 'Wallet Funded Successfully',
        message: `${formatNairaServer(amountKobo)} has been credited to your Gasflo wallet via ${tx.provider}. New balance: ${formatNairaServer(funded.newBalance)}. Ref: ${tx.reference}.`,
        type: 'WALLET',
        channels: ['IN_APP', 'EMAIL', 'SMS'],
      });
    }

    return {
      verified: true,
      status: 'VERIFIED_SUCCESS',
      reference: tx.reference,
      purpose: 'WALLET_FUNDING',
      amountKobo,
      walletBalanceKobo: funded.newBalance,
      message: 'Wallet funding verified and credited.',
    };
  }

  if (!tx.order_id) {
    throw new Error('Gateway transaction is missing associated order ID.');
  }

  const confirmed = await runInTransaction(async (tdb) => {
    const ord = await tdb.get<{ order_reference: string; customer_id: number; total_amount_kobo: number }>(
      'SELECT order_reference, customer_id, total_amount_kobo FROM orders WHERE id = ?',
      tx.order_id!
    );
    if (!ord || Number(ord.total_amount_kobo) !== amountKobo) {
      throw new Error('Verified payment amount does not match order total.');
    }

    const claim = await tdb.run(
      `UPDATE gateway_transactions SET status = 'VERIFIED_SUCCESS', provider_response_json = ?, verified_at = datetime('now') WHERE id = ? AND status != 'VERIFIED_SUCCESS'`,
      JSON.stringify(providerPayload),
      tx.id
    );
    if (claim.changes === 0) {
      return { ...ord, retailerName: '', alreadyDone: true };
    }

    const res = await confirmOrderAfterVerifiedPayment(
      Number(tx.order_id),
      tx.reference,
      'DIRECT_ONLINE',
      tx.provider,
      Number(tx.user_id)
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
    await createNotification({
      userId: Number(tx.user_id),
      roleScope: 'CUSTOMER',
      title: 'Online Payment Confirmed',
      message: `Your ${tx.provider} payment of ${formatNairaServer(amountKobo)} for order ${confirmed.order_reference} is verified. We are assigning a Uyo dispatcher.`,
      type: 'ORDER',
      channels: ['IN_APP', 'EMAIL', 'SMS'],
      relatedOrderId: Number(tx.order_id),
    });
    await notifyAllAdmins({
      title: 'New Direct-Paid Order Ready for Dispatch',
      message: `Order ${confirmed.order_reference} (${formatNairaServer(amountKobo)}) verified via ${tx.provider} is awaiting dispatcher assignment.`,
      type: 'ORDER',
      channels: ['IN_APP', 'EMAIL'],
      relatedOrderId: Number(tx.order_id),
    });
    broadcastOrderUpdate(Number(tx.order_id), Number(tx.user_id), null, 'AWAITING_DISPATCHER_ASSIGNMENT');
  }

  return {
    verified: true,
    status: 'VERIFIED_SUCCESS',
    reference: tx.reference,
    purpose: 'ORDER_PAYMENT',
    amountKobo,
    orderId: Number(tx.order_id),
    orderReference: confirmed.order_reference,
    message: 'Electronic payment verified and order confirmed.',
  };
}

export async function recordDispatcherEarningForOrder(orderId: number, dispatcherId: number): Promise<void> {
  const db = getDb();
  const existing = await db.get<{ id: number }>('SELECT id FROM dispatcher_earnings WHERE order_id = ?', orderId);
  if (existing) return;

  const order = await db.get<{ distance_km: number; delivery_state: string; delivery_city: string; order_reference: string }>(
    'SELECT distance_km, delivery_state, delivery_city, order_reference FROM orders WHERE id = ?',
    orderId
  );
  const profile = await db.get<{ compensation_model: string; base_rate_kobo: number; per_km_rate_kobo: number; zone: string }>(
    'SELECT compensation_model, base_rate_kobo, per_km_rate_kobo, zone FROM dispatcher_profiles WHERE user_id = ?',
    dispatcherId
  );

  if (!order || !profile) return;

  let baseKobo = Number(profile.base_rate_kobo);
  let distanceBonusKobo = 0;

  if (profile.compensation_model === 'FIXED') {
    distanceBonusKobo = 0;
  } else if (profile.compensation_model === 'DISTANCE') {
    baseKobo = 0;
    distanceBonusKobo = Math.max(50000, Math.round(Number(order.distance_km) * Number(profile.per_km_rate_kobo)));
  } else if (profile.compensation_model === 'ZONE') {
    const z = profile.zone.toLowerCase();
    const zoneBonus = z.includes('ewet') || z.includes('shelter') || z.includes('oron') ? 20000 : 15000;
    distanceBonusKobo = zoneBonus;
  } else {
    distanceBonusKobo = Math.round(Number(order.distance_km) * Number(profile.per_km_rate_kobo));
  }

  const totalKobo = baseKobo + distanceBonusKobo;
  const payoutRef = generateReference('BF-DSP');

  await db.run(
    `
    INSERT INTO dispatcher_earnings (
      dispatcher_id, order_id, compensation_model, base_amount_kobo, distance_bonus_kobo,
      admin_bonus_kobo, total_earning_kobo, status, payout_reference
    ) VALUES (?, ?, ?, ?, ?, 0, ?, 'APPROVED', ?)
  `,
    dispatcherId,
    orderId,
    profile.compensation_model,
    baseKobo,
    distanceBonusKobo,
    totalKobo,
    payoutRef
  );

  await db.run(
    `UPDATE dispatcher_profiles SET completed_deliveries_count = completed_deliveries_count + 1 WHERE user_id = ?`,
    dispatcherId
  );

  await writeFinancialAuditLog({
    eventType: 'DISPATCHER_EARNING_RECORDED',
    actorUserId: dispatcherId,
    actorRole: 'DISPATCHER',
    entityType: 'dispatcher_earning',
    entityId: orderId,
    reference: payoutRef,
    amountKobo: totalKobo,
    details: { orderReference: order.order_reference, model: profile.compensation_model, distanceKm: order.distance_km },
  });

  await createNotification({
    userId: dispatcherId,
    roleScope: 'DISPATCHER',
    title: 'Delivery Earning Approved',
    message: `You earned ${formatNairaServer(totalKobo)} for delivering order ${order.order_reference}. Ref: ${payoutRef}.`,
    type: 'PAYMENT',
    channels: ['IN_APP'],
    relatedOrderId: orderId,
  });
}

export async function executeAdminRefund(params: {
  orderId: number;
  adminUserId: number;
  amountKobo?: number;
  destination: 'WALLET' | 'ORIGINAL_METHOD';
  reason: string;
  adminNotes?: string;
}): Promise<{ refundReference: string; amountKobo: number; destination: string; newWalletBalanceKobo?: number }> {
  const res = await runInTransaction(async (db) => {
    const order = await db.get<{
      id: number;
      order_reference: string;
      customer_id: number;
      dispatcher_id: number | null;
      total_amount_kobo: number;
      payment_status: string;
      status: string;
    }>('SELECT * FROM orders WHERE id = ?', params.orderId);

    if (!order) {
      throw new Error('Order not found.');
    }
    if (order.payment_status !== 'PAID' && order.payment_status !== 'REFUND_PROCESSING') {
      throw new Error('Only paid orders can be refunded.');
    }

    const existingCompleted = await db.get<{ id: number; status: string }>(
      "SELECT id, status FROM refunds WHERE order_id = ? AND status = 'COMPLETED'",
      order.id
    );
    if (existingCompleted) {
      throw new Error('Duplicate refund blocked: a completed refund already exists for this order.');
    }

    const orderTotal = Number(order.total_amount_kobo);
    const refundAmount = params.amountKobo && params.amountKobo > 0 ? Math.min(params.amountKobo, orderTotal) : orderTotal;

    const existingRecord = await db.get<{ id: number; refund_reference: string }>(
      'SELECT id, refund_reference FROM refunds WHERE order_id = ?',
      order.id
    );
    const refundRef = existingRecord?.refund_reference || generateReference('BF-REF');

    let walletTxId: number | null = null;
    let newWalletBalance: number | undefined;

    if (params.destination === 'WALLET') {
      const wallet = await ensureWalletForUser(Number(order.customer_id));
      const before = wallet.balance_kobo;
      const after = before + refundAmount;
      await db.run(`UPDATE wallets SET balance_kobo = balance_kobo + ?, updated_at = datetime('now') WHERE id = ?`, refundAmount, wallet.id);

      const txInfo = await db.run(
        `
        INSERT INTO wallet_transactions (
          wallet_id, user_id, reference, idempotency_key, type, direction,
          amount_kobo, balance_before_kobo, balance_after_kobo, status,
          payment_method, order_id, description
        ) VALUES (?, ?, ?, ?, 'REFUND', 'CREDIT', ?, ?, ?, 'SUCCESS', 'WALLET_REFUND', ?, ?)
      `,
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
      await db.run(
        `
        UPDATE refunds
        SET amount_kobo = ?, destination = ?, reason = ?, status = 'COMPLETED',
            reviewed_by_admin_id = ?, admin_notes = ?, wallet_transaction_id = ?, processed_at = datetime('now')
        WHERE id = ?
      `,
        refundAmount,
        params.destination,
        params.reason,
        params.adminUserId,
        params.adminNotes || '',
        walletTxId,
        existingRecord.id
      );
    } else {
      await db.run(
        `
        INSERT INTO refunds (
          order_id, customer_id, amount_kobo, destination, reason, status,
          refund_reference, reviewed_by_admin_id, admin_notes, wallet_transaction_id, processed_at
        ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, datetime('now'))
      `,
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

    await db.run(
      `
      UPDATE retailer_settlements
      SET status = 'CANCELLED', notes = 'Cancelled due to customer order refund'
      WHERE order_id = ? AND status IN ('PENDING', 'APPROVED')
    `,
      order.id
    );

    await db.run(
      `
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
      VALUES (?, ?, 'REFUNDED', ?, 'ADMIN', ?)
    `,
      order.id,
      order.status,
      params.adminUserId,
      `Refund of ${formatNairaServer(refundAmount)} completed to ${params.destination} (${refundRef}). Reason: ${params.reason}`
    );

    await db.run(
      `UPDATE orders SET status = 'REFUNDED', payment_status = 'REFUNDED', updated_at = datetime('now') WHERE id = ?`,
      order.id
    );

    await writeFinancialAuditLog({
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
      customerId: Number(order.customer_id),
      dispatcherId: order.dispatcher_id ? Number(order.dispatcher_id) : null,
      refundReference: refundRef,
      amountKobo: refundAmount,
      destination: params.destination,
      newWalletBalanceKobo: newWalletBalance,
    };
  });

  await createNotification({
    userId: res.customerId,
    roleScope: 'CUSTOMER',
    title: 'Refund Credited',
    message: `Your refund of ${formatNairaServer(res.amountKobo)} for order ${res.orderReference} has been processed to your ${res.destination === 'WALLET' ? 'Gasflo Wallet' : 'original payment method'}. Ref: ${res.refundReference}.`,
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
