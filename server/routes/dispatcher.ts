import { Router } from 'express';
import { z } from 'zod';
import { getDb, runInTransaction } from '../db/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { advanceDispatcherOrderStatus } from '../services/dispatch.js';
import {
  broadcastOrderUpdate,
  createNotification,
  emitEventToRole,
  emitEventToUser,
  notifyAllAdmins,
} from '../services/events.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();
router.use(requireAuth, requireRole('DISPATCHER'));

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const dispatcherId = Number(req.user!.id);

    const profile = await db.get(
      `
      SELECT u.id, u.full_name, u.email, u.phone, u.status,
             dp.vehicle_type, dp.plate_number, dp.license_number, dp.zone,
             dp.availability_status, dp.current_lat, dp.current_lng,
             dp.location_tracking_enabled, dp.location_updated_at,
             dp.compensation_model, dp.base_rate_kobo, dp.per_km_rate_kobo,
             dp.rating_avg, dp.completed_deliveries_count
      FROM users u
      JOIN dispatcher_profiles dp ON dp.user_id = u.id
      WHERE u.id = ?
    `,
      dispatcherId
    );

    const counts = await db.get(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'ASSIGNED_TO_DISPATCHER' THEN 1 ELSE 0 END), 0) as new_assignments,
        COALESCE(SUM(CASE WHEN status IN ('ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT') THEN 1 ELSE 0 END), 0) as active_deliveries,
        COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as completed_deliveries,
        COALESCE(SUM(CASE WHEN status = 'DELIVERY_FAILED' THEN 1 ELSE 0 END), 0) as failed_deliveries,
        COALESCE(SUM(CASE WHEN status IN ('CANCELLED', 'REFUND_PROCESSING', 'REFUNDED') THEN 1 ELSE 0 END), 0) as cancelled_orders
      FROM orders
      WHERE dispatcher_id = ?
    `,
      dispatcherId
    );

    const earningsSummary = await db.get(
      `
      SELECT
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN total_earning_kobo ELSE 0 END), 0) as pending_kobo,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN total_earning_kobo ELSE 0 END), 0) as approved_kobo,
        COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_earning_kobo ELSE 0 END), 0) as paid_kobo,
        COALESCE(SUM(CASE WHEN status != 'REVERSED' THEN total_earning_kobo ELSE 0 END), 0) as total_earned_kobo
      FROM dispatcher_earnings
      WHERE dispatcher_id = ?
    `,
      dispatcherId
    );

    res.json({ profile, counts, earningsSummary });
  })
);

router.patch(
  '/availability',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      availabilityStatus: z.enum(['ONLINE', 'BUSY', 'OFFLINE']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid availability status.' });
      return;
    }

    const db = getDb();
    await db.run(
      `
      UPDATE dispatcher_profiles
      SET availability_status = ?,
          location_tracking_enabled = CASE WHEN ? = 'OFFLINE' THEN 0 ELSE location_tracking_enabled END
      WHERE user_id = ?
    `,
      parsed.data.availabilityStatus,
      parsed.data.availabilityStatus,
      req.user!.id
    );

    await notifyAllAdmins({
      title: 'Dispatcher Availability Updated',
      message: `${req.user!.full_name} is now ${parsed.data.availabilityStatus}.`,
      type: 'DISPATCH',
      channels: ['IN_APP'],
    });
    emitEventToRole('ADMIN', 'dispatcher_update', {
      dispatcherId: req.user!.id,
      availabilityStatus: parsed.data.availabilityStatus,
    });

    res.json({ ok: true, availabilityStatus: parsed.data.availabilityStatus });
  })
);

router.patch(
  '/location',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      trackingEnabled: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid location payload.' });
      return;
    }

    const db = getDb();
    const activeOrders = await db.all<{ id: number; customer_id: number }>(
      `
      SELECT id, customer_id FROM orders
      WHERE dispatcher_id = ?
        AND status IN ('ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT')
    `,
      req.user!.id
    );

    if (parsed.data.trackingEnabled === true && activeOrders.length === 0) {
      res.status(400).json({
        error: 'Live location sharing is restricted to active deliveries for privacy protection.',
      });
      return;
    }

    const nextTracking =
      parsed.data.trackingEnabled !== undefined ? (parsed.data.trackingEnabled ? 1 : 0) : activeOrders.length > 0 ? 1 : 0;

    await db.run(
      `
      UPDATE dispatcher_profiles
      SET current_lat = COALESCE(?, current_lat),
          current_lng = COALESCE(?, current_lng),
          location_tracking_enabled = ?,
          location_updated_at = datetime('now')
      WHERE user_id = ?
    `,
      parsed.data.lat ?? null,
      parsed.data.lng ?? null,
      nextTracking,
      req.user!.id
    );

    const updated = (await db.get<{
      current_lat: number;
      current_lng: number;
      location_tracking_enabled: number;
      location_updated_at: string;
    }>(
      'SELECT current_lat, current_lng, location_tracking_enabled, location_updated_at FROM dispatcher_profiles WHERE user_id = ?',
      req.user!.id
    ))!;

    for (const ord of activeOrders) {
      emitEventToUser(Number(ord.customer_id), 'dispatcher_location', {
        orderId: Number(ord.id),
        lat: updated.current_lat,
        lng: updated.current_lng,
        trackingEnabled: Number(updated.location_tracking_enabled) === 1,
        updatedAt: updated.location_updated_at,
      });
    }
    emitEventToRole('ADMIN', 'dispatcher_location', {
      dispatcherId: req.user!.id,
      lat: updated.current_lat,
      lng: updated.current_lng,
      trackingEnabled: Number(updated.location_tracking_enabled) === 1,
    });

    res.json({ location: updated });
  })
);

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const dispatcherId = Number(req.user!.id);

    const orders = await db.all<Record<string, unknown>>(
      `
      SELECT
        o.id, o.order_reference, o.status, o.payment_status,
        o.delivery_address, o.delivery_neighbourhood, o.delivery_city, o.delivery_state,
        o.delivery_lat, o.delivery_lng, o.delivery_instructions,
        o.distance_km, o.estimated_delivery_mins,
        o.proof_of_delivery_note, o.failure_reason, o.failure_notes,
        o.assigned_at, o.accepted_at, o.collected_at, o.in_transit_at, o.delivered_at, o.created_at,
        c.full_name as customer_name, c.phone as customer_phone,
        r.business_name as retailer_name, r.contact_person as retailer_contact,
        r.phone as retailer_phone, r.address as retailer_address,
        r.neighbourhood as retailer_neighbourhood, r.city as retailer_city,
        r.lat as retailer_lat, r.lng as retailer_lng
      FROM orders o
      JOIN users c ON c.id = o.customer_id
      JOIN retailers r ON r.id = o.retailer_id
      WHERE o.dispatcher_id = ?
      ORDER BY
        CASE
          WHEN o.status IN ('ASSIGNED_TO_DISPATCHER', 'ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT') THEN 0
          ELSE 1
        END,
        o.updated_at DESC
    `,
      dispatcherId
    );

    const orderIds = orders.map((o) => Number(o.id));
    const itemsByOrder = new Map<number, unknown[]>();
    if (orderIds.length > 0) {
      const ph = orderIds.map(() => '?').join(',');
      const items = await db.all<{ order_id: number }>(
        `SELECT id, order_id, product_name, size_kg, quantity FROM order_items WHERE order_id IN (${ph})`,
        ...orderIds
      );
      for (const it of items) {
        const oid = Number(it.order_id);
        const arr = itemsByOrder.get(oid) || [];
        arr.push(it);
        itemsByOrder.set(oid, arr);
      }
    }

    const formatted = orders.map((o) => ({
      ...o,
      paymentNotice: 'PREPAID ELECTRONICALLY — DO NOT COLLECT CASH FROM CUSTOMER',
      items: itemsByOrder.get(Number(o.id)) || [],
    }));

    res.json({ orders: formatted });
  })
);

router.post(
  '/orders/:id/status',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      nextStatus: z.enum([
        'ACCEPTED_BY_DISPATCHER',
        'AWAITING_COLLECTION',
        'COLLECTED_FROM_RETAILER',
        'IN_TRANSIT',
        'DELIVERED',
      ]),
      note: z.string().max(400).optional(),
      confirmationCode: z.string().max(10).optional(),
      proofOfDeliveryNote: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid status update.' });
      return;
    }

    try {
      const result = await advanceDispatcherOrderStatus({
        orderId: Number(req.params.id),
        dispatcherId: Number(req.user!.id),
        nextStatus: parsed.data.nextStatus,
        note: parsed.data.note,
        confirmationCode: parsed.data.confirmationCode,
        proofOfDeliveryNote: parsed.data.proofOfDeliveryNote,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  })
);

router.post(
  '/orders/:id/report-failure',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      reason: z.enum([
        'CUSTOMER_UNAVAILABLE',
        'INCORRECT_ADDRESS',
        'RETAILER_UNABLE_TO_SUPPLY',
        'PRODUCT_UNAVAILABLE',
        'VEHICLE_PROBLEM',
        'OTHER',
      ]),
      notes: z.string().min(6, 'Please provide clear details about the issue').max(600),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Please specify failure reason and details.' });
      return;
    }

    const orderId = Number(req.params.id);
    const dispatcherId = Number(req.user!.id);

    const updated = await runInTransaction(async (db) => {
      const order = await db.get<{ id: number; order_reference: string; customer_id: number; status: string }>(
        'SELECT id, order_reference, customer_id, status FROM orders WHERE id = ? AND dispatcher_id = ?',
        orderId,
        dispatcherId
      );

      if (!order) {
        throw new Error('Assigned delivery job not found.');
      }
      if (['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status)) {
        throw new Error('Cannot report failure on a closed order.');
      }

      await db.run(
        `
        UPDATE orders
        SET status = 'DELIVERY_FAILED',
            failure_reason = ?,
            failure_notes = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `,
        parsed.data.reason,
        parsed.data.notes.trim(),
        order.id
      );

      await db.run(
        `
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
        VALUES (?, ?, 'DELIVERY_FAILED', ?, 'DISPATCHER', ?)
      `,
        order.id,
        order.status,
        dispatcherId,
        `Reported ${parsed.data.reason}: ${parsed.data.notes.trim()}`
      );

      const remaining = await db.get<{ cnt: number }>(
        `
        SELECT COUNT(*) as cnt FROM orders
        WHERE dispatcher_id = ? AND status IN ('ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT')
      `,
        dispatcherId
      );
      if (Number(remaining?.cnt || 0) === 0) {
        await db.run(
          `
          UPDATE dispatcher_profiles
          SET location_tracking_enabled = 0, availability_status = CASE WHEN availability_status = 'BUSY' THEN 'ONLINE' ELSE availability_status END
          WHERE user_id = ?
        `,
          dispatcherId
        );
      }

      return order;
    });

    await createNotification({
      userId: Number(updated.customer_id),
      roleScope: 'CUSTOMER',
      title: 'Delivery Issue Reported',
      message: `Your dispatcher reported an issue with order ${updated.order_reference} (${parsed.data.reason.replace(/_/g, ' ')}). BlueFlame Uyo Operations has been notified to resolve, reschedule, or process a refund.`,
      type: 'ALERT',
      channels: ['IN_APP', 'SMS'],
      relatedOrderId: orderId,
    });

    await notifyAllAdmins({
      title: `Delivery Failure Reported (${updated.order_reference})`,
      message: `${req.user!.full_name} reported ${parsed.data.reason}: ${parsed.data.notes.trim()}. Review to reassign, resolve, or refund.`,
      type: 'ALERT',
      channels: ['IN_APP', 'EMAIL'],
      relatedOrderId: orderId,
    });

    broadcastOrderUpdate(orderId, Number(updated.customer_id), dispatcherId, 'DELIVERY_FAILED');

    res.json({ ok: true, status: 'DELIVERY_FAILED' });
  })
);

router.get(
  '/earnings',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const dispatcherId = Number(req.user!.id);
    const earnings = await db.all(
      `
      SELECT de.*, o.order_reference, o.delivery_neighbourhood, o.delivery_city, o.distance_km, o.delivered_at
      FROM dispatcher_earnings de
      JOIN orders o ON o.id = de.order_id
      WHERE de.dispatcher_id = ?
      ORDER BY de.created_at DESC
    `,
      dispatcherId
    );

    const summary = await db.get(
      `
      SELECT
        COUNT(*) as total_jobs,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN total_earning_kobo ELSE 0 END), 0) as pending_kobo,
        COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN total_earning_kobo ELSE 0 END), 0) as approved_kobo,
        COALESCE(SUM(CASE WHEN status = 'PAID' THEN total_earning_kobo ELSE 0 END), 0) as paid_kobo
      FROM dispatcher_earnings
      WHERE dispatcher_id = ? AND status != 'REVERSED'
    `,
      dispatcherId
    );

    res.json({ earnings, summary });
  })
);

export default router;
