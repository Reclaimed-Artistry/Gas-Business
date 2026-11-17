import { getDb, runInTransaction } from '../db/database.js';
import { haversineDistanceKm } from './geo.js';
import { broadcastOrderUpdate, createNotification, notifyAllAdmins } from './events.js';
import { recordDispatcherEarningForOrder } from './payment.js';

export const ORDER_STATUSES = [
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
  'REFUNDED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface DispatcherCandidate {
  dispatcherId: number;
  fullName: string;
  phone: string;
  vehicleType: string;
  plateNumber: string;
  zone: string;
  availabilityStatus: string;
  distanceToRetailerKm: number;
  distanceRetailerToCustomerKm: number;
  totalEstimatedRouteKm: number;
  activeJobsCount: number;
  ratingAvg: number;
  completedDeliveriesCount: number;
  score: number;
  recommendationReason: string;
}

export async function rankDispatchersForOrder(orderId: number): Promise<DispatcherCandidate[]> {
  const db = getDb();
  const order = await db.get<{
    id: number;
    delivery_lat: number;
    delivery_lng: number;
    distance_km: number;
    retailer_lat: number;
    retailer_lng: number;
  }>(
    `
    SELECT o.id, o.delivery_lat, o.delivery_lng, o.distance_km,
           r.lat as retailer_lat, r.lng as retailer_lng
    FROM orders o
    JOIN retailers r ON r.id = o.retailer_id
    WHERE o.id = ?
  `,
    orderId
  );

  if (!order) {
    throw new Error('Order not found.');
  }

  const dispatchers = await db.all<{
    user_id: number;
    full_name: string;
    phone: string;
    vehicle_type: string;
    plate_number: string;
    zone: string;
    availability_status: string;
    current_lat: number;
    current_lng: number;
    rating_avg: number;
    completed_deliveries_count: number;
    active_jobs_count: number;
  }>(
    `
    SELECT u.id as user_id, u.full_name, u.phone,
           dp.vehicle_type, dp.plate_number, dp.zone, dp.availability_status,
           dp.current_lat, dp.current_lng, dp.rating_avg, dp.completed_deliveries_count,
           (
             SELECT COUNT(*) FROM orders ao
             WHERE ao.dispatcher_id = u.id
               AND ao.status IN ('ASSIGNED_TO_DISPATCHER', 'ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT')
           ) as active_jobs_count
    FROM users u
    JOIN dispatcher_profiles dp ON dp.user_id = u.id
    WHERE u.role = 'DISPATCHER' AND u.status = 'ACTIVE'
  `
  );

  const leg2Km = haversineDistanceKm(
    { lat: Number(order.retailer_lat), lng: Number(order.retailer_lng) },
    { lat: Number(order.delivery_lat), lng: Number(order.delivery_lng) }
  );

  const candidates: DispatcherCandidate[] = dispatchers.map((d) => {
    const leg1Km = haversineDistanceKm(
      { lat: Number(d.current_lat), lng: Number(d.current_lng) },
      { lat: Number(order.retailer_lat), lng: Number(order.retailer_lng) }
    );
    const totalRoute = Math.round((leg1Km + leg2Km) * 100) / 100;
    const activeJobs = Number(d.active_jobs_count);
    const ratingAvg = Number(d.rating_avg);

    let score = 100;
    if (d.availability_status === 'ONLINE') score += 20;
    else if (d.availability_status === 'BUSY') score -= 15;
    else score -= 50;

    score -= leg1Km * 3.5;
    score -= activeJobs * 18;
    score += (ratingAvg - 4.0) * 8;

    const reasons: string[] = [];
    if (d.availability_status === 'ONLINE') reasons.push('Online & ready');
    else reasons.push(`Currently ${d.availability_status.toLowerCase()}`);
    reasons.push(`${leg1Km.toFixed(1)} km from retailer`);
    reasons.push(`${activeJobs} active job${activeJobs === 1 ? '' : 's'}`);

    return {
      dispatcherId: Number(d.user_id),
      fullName: d.full_name,
      phone: d.phone,
      vehicleType: d.vehicle_type,
      plateNumber: d.plate_number,
      zone: d.zone,
      availabilityStatus: d.availability_status,
      distanceToRetailerKm: leg1Km,
      distanceRetailerToCustomerKm: leg2Km,
      totalEstimatedRouteKm: totalRoute,
      activeJobsCount: activeJobs,
      ratingAvg,
      completedDeliveriesCount: Number(d.completed_deliveries_count),
      score: Math.round(score * 10) / 10,
      recommendationReason: reasons.join(' · '),
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export async function assignDispatcherToOrder(params: {
  orderId: number;
  dispatcherId: number;
  adminUserId: number;
  isAutoAssigned?: boolean;
  note?: string;
}): Promise<{ orderReference: string; dispatcherName: string }> {
  const result = await runInTransaction(async (db) => {
    const order = await db.get<{
      id: number;
      order_reference: string;
      customer_id: number;
      dispatcher_id: number | null;
      status: string;
      payment_status: string;
      retailer_name: string;
      retailer_address: string;
      delivery_address: string;
    }>(
      `
      SELECT o.*, r.business_name as retailer_name, r.address as retailer_address
      FROM orders o
      JOIN retailers r ON r.id = o.retailer_id
      WHERE o.id = ?
    `,
      params.orderId
    );

    if (!order) throw new Error('Order not found.');
    if (order.payment_status !== 'PAID') {
      throw new Error('Cannot assign a dispatcher until electronic payment is confirmed.');
    }
    if (['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw new Error(`Cannot assign dispatcher to an order in status ${order.status}.`);
    }

    const dispatcher = await db.get<{ id: number; full_name: string; status: string }>(
      "SELECT id, full_name, status FROM users WHERE id = ? AND role = 'DISPATCHER'",
      params.dispatcherId
    );
    if (!dispatcher || dispatcher.status !== 'ACTIVE') {
      throw new Error('Selected dispatcher is not active.');
    }

    const previousDispatcherId = order.dispatcher_id ? Number(order.dispatcher_id) : null;
    const isReassignment = Boolean(previousDispatcherId && previousDispatcherId !== Number(dispatcher.id));

    await db.run(
      `
      UPDATE orders
      SET dispatcher_id = ?,
          status = 'ASSIGNED_TO_DISPATCHER',
          assigned_at = datetime('now'),
          failure_reason = '',
          failure_notes = '',
          updated_at = datetime('now')
      WHERE id = ?
    `,
      dispatcher.id,
      order.id
    );

    await db.run(
      `
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
      VALUES (?, ?, 'ASSIGNED_TO_DISPATCHER', ?, 'ADMIN', ?)
    `,
      order.id,
      order.status,
      params.adminUserId,
      params.note ||
        `${params.isAutoAssigned ? 'Auto-assigned' : isReassignment ? 'Reassigned' : 'Assigned'} to dispatcher ${dispatcher.full_name}`
    );

    return {
      orderReference: order.order_reference,
      customerId: Number(order.customer_id),
      previousDispatcherId,
      dispatcherId: Number(dispatcher.id),
      dispatcherName: dispatcher.full_name,
      retailerName: order.retailer_name,
      retailerAddress: order.retailer_address,
      deliveryAddress: order.delivery_address,
      isReassignment,
    };
  });

  await createNotification({
    userId: result.dispatcherId,
    roleScope: 'DISPATCHER',
    title: result.isReassignment ? 'Reassigned Delivery Job' : 'New Delivery Assignment',
    message: `Order ${result.orderReference}: Collect from ${result.retailerName} (${result.retailerAddress}) and deliver to ${result.deliveryAddress}.`,
    type: 'DISPATCH',
    channels: ['IN_APP', 'SMS'],
    relatedOrderId: params.orderId,
  });

  if (result.previousDispatcherId && result.previousDispatcherId !== result.dispatcherId) {
    await createNotification({
      userId: result.previousDispatcherId,
      roleScope: 'DISPATCHER',
      title: 'Order Reassigned',
      message: `Order ${result.orderReference} has been reassigned to another dispatcher by Operations Admin.`,
      type: 'DISPATCH',
      channels: ['IN_APP'],
      relatedOrderId: params.orderId,
    });
  }

  await createNotification({
    userId: result.customerId,
    roleScope: 'CUSTOMER',
    title: 'Dispatcher Assigned to Your Order',
    message: `${result.dispatcherName} has been assigned to deliver your order ${result.orderReference}. Remember: your order is fully prepaid electronically — do not pay cash.`,
    type: 'DELIVERY',
    channels: ['IN_APP', 'SMS'],
    relatedOrderId: params.orderId,
  });

  broadcastOrderUpdate(params.orderId, result.customerId, result.dispatcherId, 'ASSIGNED_TO_DISPATCHER');

  return {
    orderReference: result.orderReference,
    dispatcherName: result.dispatcherName,
  };
}

export async function advanceDispatcherOrderStatus(params: {
  orderId: number;
  dispatcherId: number;
  nextStatus:
    | 'ACCEPTED_BY_DISPATCHER'
    | 'AWAITING_COLLECTION'
    | 'COLLECTED_FROM_RETAILER'
    | 'IN_TRANSIT'
    | 'DELIVERED';
  note?: string;
  confirmationCode?: string;
  proofOfDeliveryNote?: string;
}): Promise<{ orderReference: string; status: string }> {
  const allowedNext: Record<string, string[]> = {
    ASSIGNED_TO_DISPATCHER: ['ACCEPTED_BY_DISPATCHER'],
    ACCEPTED_BY_DISPATCHER: ['AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER'],
    AWAITING_COLLECTION: ['COLLECTED_FROM_RETAILER'],
    COLLECTED_FROM_RETAILER: ['IN_TRANSIT'],
    IN_TRANSIT: ['DELIVERED'],
  };

  const result = await runInTransaction(async (db) => {
    const order = await db.get<{
      id: number;
      order_reference: string;
      customer_id: number;
      dispatcher_id: number;
      status: string;
      delivery_confirmation_code: string;
      retailer_name: string;
      dispatcher_name: string;
    }>(
      `
      SELECT o.*, r.business_name as retailer_name, u.full_name as dispatcher_name
      FROM orders o
      JOIN retailers r ON r.id = o.retailer_id
      JOIN users u ON u.id = o.dispatcher_id
      WHERE o.id = ? AND o.dispatcher_id = ?
    `,
      params.orderId,
      params.dispatcherId
    );

    if (!order) {
      throw new Error('Assigned delivery job not found for your dispatcher account.');
    }

    const permitted = allowedNext[order.status] || [];
    if (!permitted.includes(params.nextStatus)) {
      throw new Error(`Invalid status transition from ${order.status} to ${params.nextStatus}.`);
    }

    if (params.nextStatus === 'DELIVERED' && params.confirmationCode) {
      if (params.confirmationCode.trim() !== order.delivery_confirmation_code) {
        throw new Error('Customer delivery confirmation PIN does not match. Ask the customer for their 4-digit code.');
      }
    }

    const timestampCol: Record<string, string> = {
      ACCEPTED_BY_DISPATCHER: 'accepted_at',
      COLLECTED_FROM_RETAILER: 'collected_at',
      IN_TRANSIT: 'in_transit_at',
      DELIVERED: 'delivered_at',
    };

    const tsField = timestampCol[params.nextStatus];
    const extraUpdate = tsField ? `, ${tsField} = datetime('now')` : '';
    const podUpdate = params.nextStatus === 'DELIVERED' ? `, proof_of_delivery_note = ?` : '';

    const sql = `UPDATE orders SET status = ? ${extraUpdate} ${podUpdate}, updated_at = datetime('now') WHERE id = ?`;
    if (params.nextStatus === 'DELIVERED') {
      await db.run(sql, params.nextStatus, params.proofOfDeliveryNote || 'Delivered and verified electronically', order.id);
    } else {
      await db.run(sql, params.nextStatus, order.id);
    }

    if (params.nextStatus === 'DELIVERED') {
      await recordDispatcherEarningForOrder(Number(order.id), params.dispatcherId);
      const remainingActive = await db.get<{ cnt: number }>(
        `
        SELECT COUNT(*) as cnt FROM orders
        WHERE dispatcher_id = ? AND status IN ('ACCEPTED_BY_DISPATCHER', 'AWAITING_COLLECTION', 'COLLECTED_FROM_RETAILER', 'IN_TRANSIT')
      `,
        params.dispatcherId
      );
      if (Number(remainingActive?.cnt || 0) === 0) {
        await db.run(
          `
          UPDATE dispatcher_profiles
          SET location_tracking_enabled = 0, availability_status = CASE WHEN availability_status = 'BUSY' THEN 'ONLINE' ELSE availability_status END
          WHERE user_id = ?
        `,
          params.dispatcherId
        );
      }
    } else if (params.nextStatus === 'ACCEPTED_BY_DISPATCHER') {
      await db.run(`UPDATE dispatcher_profiles SET availability_status = 'BUSY' WHERE user_id = ?`, params.dispatcherId);
    }

    await db.run(
      `
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, changed_by_role, note)
      VALUES (?, ?, ?, ?, 'DISPATCHER', ?)
    `,
      order.id,
      order.status,
      params.nextStatus,
      params.dispatcherId,
      params.note || `Dispatcher updated status to ${params.nextStatus.replace(/_/g, ' ')}`
    );

    return order;
  });

  const customerMessages: Record<string, { title: string; body: string }> = {
    ACCEPTED_BY_DISPATCHER: {
      title: 'Dispatcher Accepted Your Order',
      body: `${result.dispatcher_name} has accepted your order ${result.order_reference} and is heading to ${result.retailer_name}.`,
    },
    AWAITING_COLLECTION: {
      title: 'Dispatcher Arrived at Retailer',
      body: `${result.dispatcher_name} is at ${result.retailer_name} preparing your cooking gas order ${result.order_reference}.`,
    },
    COLLECTED_FROM_RETAILER: {
      title: 'Order Collected from Retailer',
      body: `Your cooking gas order ${result.order_reference} has been collected from ${result.retailer_name}.`,
    },
    IN_TRANSIT: {
      title: 'Your Cooking Gas Is On The Way!',
      body: `${result.dispatcher_name} is now in transit to your delivery address with order ${result.order_reference}. Have your confirmation PIN (${result.delivery_confirmation_code}) ready.`,
    },
    DELIVERED: {
      title: 'Order Delivered Successfully',
      body: `Your order ${result.order_reference} has been delivered! You can now rate your delivery experience in your dashboard.`,
    },
  };

  const msg = customerMessages[params.nextStatus];
  if (msg) {
    await createNotification({
      userId: Number(result.customer_id),
      roleScope: 'CUSTOMER',
      title: msg.title,
      message: msg.body,
      type: 'DELIVERY',
      channels: ['IN_APP', 'SMS'],
      relatedOrderId: params.orderId,
    });
  }

  await notifyAllAdmins({
    title: `Order ${result.order_reference}: ${params.nextStatus.replace(/_/g, ' ')}`,
    message: `Dispatcher ${result.dispatcher_name} updated order ${result.order_reference} to ${params.nextStatus.replace(/_/g, ' ')}.`,
    type: 'DELIVERY',
    channels: ['IN_APP'],
    relatedOrderId: params.orderId,
  });

  broadcastOrderUpdate(params.orderId, Number(result.customer_id), params.dispatcherId, params.nextStatus);

  return { orderReference: result.order_reference, status: params.nextStatus };
}
