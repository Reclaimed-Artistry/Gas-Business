import type { Response } from 'express';
import { getDb } from '../db/database.js';

export type UserRole = 'CUSTOMER' | 'DISPATCHER' | 'ADMIN';

interface SseClient {
  id: string;
  userId: number;
  role: UserRole;
  res: Response;
}

const clients = new Map<string, SseClient>();

export function registerSseClient(clientId: string, userId: number, role: UserRole, res: Response): void {
  clients.set(clientId, { id: clientId, userId, role, res });
}

export function unregisterSseClient(clientId: string): void {
  clients.delete(clientId);
}

export function emitEventToUser(userId: number, event: string, payload: unknown): void {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients.values()) {
    if (client.userId === userId) {
      try {
        client.res.write(data);
      } catch {
        clients.delete(client.id);
      }
    }
  }
}

export function emitEventToRole(role: UserRole, event: string, payload: unknown): void {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients.values()) {
    if (client.role === role) {
      try {
        client.res.write(data);
      } catch {
        clients.delete(client.id);
      }
    }
  }
}

export interface CreateNotificationInput {
  userId: number;
  roleScope: UserRole;
  title: string;
  message: string;
  type?: 'ORDER' | 'PAYMENT' | 'WALLET' | 'DELIVERY' | 'DISPATCH' | 'REFUND' | 'ALERT' | 'INFO';
  channels?: ('IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP')[];
  relatedOrderId?: number | null;
}

export function createNotification(input: CreateNotificationInput): number {
  const db = getDb();
  const channels = input.channels || ['IN_APP', 'EMAIL'];
  const stmt = db.prepare(`
    INSERT INTO notifications (user_id, role_scope, title, message, type, channels_json, related_order_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    input.userId,
    input.roleScope,
    input.title,
    input.message,
    input.type || 'INFO',
    JSON.stringify(channels),
    input.relatedOrderId ?? null
  );
  const notificationId = Number(info.lastInsertRowid);
  emitEventToUser(input.userId, 'notification', {
    id: notificationId,
    title: input.title,
    message: input.message,
    type: input.type || 'INFO',
    channels,
    relatedOrderId: input.relatedOrderId ?? null,
    created_at: new Date().toISOString(),
  });
  return notificationId;
}

export function notifyAllAdmins(input: Omit<CreateNotificationInput, 'userId' | 'roleScope'>): void {
  const db = getDb();
  const admins = db
    .prepare("SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'")
    .all() as { id: number }[];
  for (const admin of admins) {
    createNotification({
      ...input,
      userId: admin.id,
      roleScope: 'ADMIN',
    });
  }
}

export function broadcastOrderUpdate(orderId: number, customerId: number, dispatcherId: number | null, status: string): void {
  const payload = { orderId, status, updatedAt: new Date().toISOString() };
  emitEventToUser(customerId, 'order_update', payload);
  if (dispatcherId) {
    emitEventToUser(dispatcherId, 'order_update', payload);
  }
  emitEventToRole('ADMIN', 'order_update', payload);
}
