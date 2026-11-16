import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb } from '../db/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { initializeGatewayTransaction, verifyGatewayTransaction } from '../services/payment.js';

const router = Router();

// Customer initializes electronic Wallet Funding via Paystack or Flutterwave
router.post('/wallet/fund/init', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  const schema = z.object({
    amountNaira: z.number().min(500, 'Minimum wallet funding amount is ₦500').max(2000000, 'Maximum single funding is ₦2,000,000'),
    provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']),
    channel: z.enum(['CARD', 'BANK_TRANSFER', 'USSD']),
    idempotencyKey: z.string().max(100).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid funding details.' });
    return;
  }

  const amountKobo = Math.round(parsed.data.amountNaira * 100);
  const gw = initializeGatewayTransaction({
    userId: req.user!.id,
    purpose: 'WALLET_FUNDING',
    provider: parsed.data.provider,
    channel: parsed.data.channel,
    amountKobo,
    idempotencyKey: parsed.data.idempotencyKey,
  });

  res.status(201).json({
    gateway: gw,
    message: 'Payment initialized. Complete verification through the electronic payment gateway.',
  });
});

// Re-initialize online payment for an unpaid (AWAITING_PAYMENT / FAILED) order
router.post('/order/:orderId/init', requireAuth, requireRole('CUSTOMER'), (req, res) => {
  const schema = z.object({
    provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']),
    channel: z.enum(['CARD', 'BANK_TRANSFER', 'USSD']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Select a valid electronic payment provider and channel.' });
    return;
  }

  const db = getDb();
  const order = db
    .prepare('SELECT id, total_amount_kobo, payment_status FROM orders WHERE id = ? AND customer_id = ?')
    .get(Number(req.params.orderId), req.user!.id) as
    | { id: number; total_amount_kobo: number; payment_status: string }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (order.payment_status === 'PAID') {
    res.status(400).json({ error: 'Order is already paid.' });
    return;
  }

  const gw = initializeGatewayTransaction({
    userId: req.user!.id,
    purpose: 'ORDER_PAYMENT',
    orderId: order.id,
    provider: parsed.data.provider,
    channel: parsed.data.channel,
    amountKobo: order.total_amount_kobo,
  });

  res.status(201).json({ gateway: gw });
});

// Server-side independent verification endpoint (credits wallet or confirms order ONLY after server verification!)
router.post('/verify', requireAuth, requireRole('CUSTOMER'), async (req, res) => {
  const schema = z.object({
    reference: z.string().min(5),
    simulatedOutcome: z.enum(['SUCCESS', 'FAILED']).optional(),
    paymentChannelDetails: z.record(z.unknown()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid transaction reference is required.' });
    return;
  }

  try {
    const result = await verifyGatewayTransaction({
      reference: parsed.data.reference,
      userId: req.user!.id,
      simulatedOutcome: parsed.data.simulatedOutcome,
      paymentChannelDetails: parsed.data.paymentChannelDetails,
    });
    res.status(result.verified ? 200 : 402).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Paystack Webhook receiver (ready for live deployment with PAYSTACK_SECRET_KEY)
router.post('/webhooks/paystack', async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (secret) {
    const signature = req.headers['x-paystack-signature'];
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');
    if (signature !== hash) {
      res.status(401).json({ error: 'Invalid Paystack webhook signature.' });
      return;
    }
  }
  const event = req.body?.event;
  const ref = req.body?.data?.reference;
  if (event === 'charge.success' && typeof ref === 'string') {
    const db = getDb();
    const tx = db.prepare('SELECT user_id FROM gateway_transactions WHERE reference = ?').get(ref) as
      | { user_id: number }
      | undefined;
    if (tx) {
      await verifyGatewayTransaction({ reference: ref, userId: tx.user_id, simulatedOutcome: 'SUCCESS' }).catch(() => {});
    }
  }
  res.json({ received: true });
});

// Flutterwave Webhook receiver (ready for live deployment with FLUTTERWAVE_WEBHOOK_HASH)
router.post('/webhooks/flutterwave', async (req, res) => {
  const hash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
  if (hash && req.headers['verif-hash'] !== hash) {
    res.status(401).json({ error: 'Invalid Flutterwave webhook hash.' });
    return;
  }
  const ref = req.body?.data?.tx_ref;
  if (req.body?.data?.status === 'successful' && typeof ref === 'string') {
    const db = getDb();
    const tx = db.prepare('SELECT user_id FROM gateway_transactions WHERE reference = ?').get(ref) as
      | { user_id: number }
      | undefined;
    if (tx) {
      await verifyGatewayTransaction({ reference: ref, userId: tx.user_id, simulatedOutcome: 'SUCCESS' }).catch(() => {});
    }
  }
  res.json({ received: true });
});

export default router;
