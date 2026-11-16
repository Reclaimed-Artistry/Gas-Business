import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getDb, runInTransaction } from '../db/database.js';
import {
  clearAuthCookie,
  hashPassword,
  requireAuth,
  setAuthCookie,
  signToken,
  verifyPassword,
} from '../middleware/auth.js';
import { ensureWalletForUser } from '../services/payment.js';
import { registerSseClient, unregisterSseClient } from '../services/events.js';

const router = Router();

const registerCustomerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(120),
  email: z.string().email('Valid email address is required'),
  phone: z.string().min(8, 'Valid Nigerian phone number is required').max(25),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * Public registration is STRICTLY limited to CUSTOMERS.
 * Retailers never have login accounts; Dispatchers are created exclusively by Administrator.
 */
router.post('/register', (req, res) => {
  if (req.body?.role && String(req.body.role).toUpperCase() !== 'CUSTOMER') {
    res.status(403).json({
      error:
        'Public registration is only available for customers. Retailers are centrally managed by Operations and dispatchers are onboarded by the Administrator.',
    });
    return;
  }

  const parsed = registerCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
    return;
  }

  const { fullName, email, phone, password } = parsed.data;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'An account with this email address already exists.' });
    return;
  }

  const created = runInTransaction((tdb) => {
    const hash = hashPassword(password);
    const info = tdb
      .prepare(`
        INSERT INTO users (role, full_name, email, phone, password_hash, status)
        VALUES ('CUSTOMER', ?, ?, ?, ?, 'ACTIVE')
      `)
      .run(fullName.trim(), email.trim().toLowerCase(), phone.trim(), hash);
    const userId = Number(info.lastInsertRowid);
    tdb.prepare('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, 0)').run(userId);
    return {
      id: userId,
      role: 'CUSTOMER' as const,
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      status: 'ACTIVE',
    };
  });

  const token = signToken(created);
  setAuthCookie(res, token);
  res.status(201).json({ user: created, token, walletBalanceKobo: 0 });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please provide a valid email and password.' });
    return;
  }

  const db = getDb();
  const user = db
    .prepare('SELECT id, role, full_name, email, phone, password_hash, status, avatar_url FROM users WHERE email = ?')
    .get(parsed.data.email.trim().toLowerCase()) as
    | {
        id: number;
        role: 'CUSTOMER' | 'DISPATCHER' | 'ADMIN';
        full_name: string;
        email: string;
        phone: string;
        password_hash: string;
        status: string;
        avatar_url: string | null;
      }
    | undefined;

  if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid email address or password.' });
    return;
  }

  if (user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'This account is currently suspended or inactive. Contact Operations.' });
    return;
  }

  const token = signToken(user);
  setAuthCookie(res, token);

  let walletBalanceKobo: number | undefined;
  let dispatcherProfile: unknown;
  if (user.role === 'CUSTOMER') {
    walletBalanceKobo = ensureWalletForUser(user.id).balance_kobo;
  } else if (user.role === 'DISPATCHER') {
    dispatcherProfile = db.prepare('SELECT * FROM dispatcher_profiles WHERE user_id = ?').get(user.id);
  }

  res.json({
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      avatar_url: user.avatar_url,
    },
    token,
    walletBalanceKobo,
    dispatcherProfile,
  });
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.user!;
  let walletBalanceKobo: number | undefined;
  let dispatcherProfile: unknown;
  if (user.role === 'CUSTOMER') {
    walletBalanceKobo = ensureWalletForUser(user.id).balance_kobo;
  } else if (user.role === 'DISPATCHER') {
    dispatcherProfile = db.prepare('SELECT * FROM dispatcher_profiles WHERE user_id = ?').get(user.id);
  }
  const unreadCount = (
    db
      .prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(user.id) as { cnt: number }
  ).cnt;

  res.json({ user, walletBalanceKobo, dispatcherProfile, unreadNotifications: unreadCount });
});

router.patch('/profile', requireAuth, (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2).max(120).optional(),
    phone: z.string().min(8).max(25).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile update.' });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;

  if (parsed.data.newPassword) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string };
    if (!parsed.data.currentPassword || !verifyPassword(parsed.data.currentPassword, row.password_hash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
      hashPassword(parsed.data.newPassword),
      userId
    );
  }

  if (parsed.data.fullName || parsed.data.phone) {
    db.prepare(`
      UPDATE users
      SET full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(parsed.data.fullName?.trim() ?? null, parsed.data.phone?.trim() ?? null, userId);
  }

  const updated = db
    .prepare('SELECT id, role, full_name, email, phone, status, avatar_url FROM users WHERE id = ?')
    .get(userId);
  res.json({ user: updated });
});

router.get('/notifications', requireAuth, (req, res) => {
  const db = getDb();
  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(req.user!.id);
  const unreadCount = (
    db
      .prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(req.user!.id) as { cnt: number }
  ).cnt;
  res.json({ notifications, unreadCount });
});

router.patch('/notifications/:id/read', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.user!.id
  );
  res.json({ ok: true });
});

router.post('/notifications/read-all', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

// Server-Sent Events stream for live order, dispatch, and notification synchronization across dashboards
router.get('/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = crypto.randomUUID();
  registerSseClient(clientId, req.user!.id, req.user!.role, res);
  res.write(`retry: 8000\nevent: connected\ndata: ${JSON.stringify({ userId: req.user!.id, role: req.user!.role })}\n\n`);

  // On Vercel serverless functions, close cleanly before maxDuration so EventSource reconnects without 504
  const vercelCloseTimer = process.env.VERCEL
    ? setTimeout(() => {
        clearInterval(heartbeat);
        unregisterSseClient(clientId);
        try {
          res.end();
        } catch {
          // ignore
        }
      }, 15000)
    : null;

  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 12000);

  req.on('close', () => {
    if (vercelCloseTimer) clearTimeout(vercelCloseTimer);
    clearInterval(heartbeat);
    unregisterSseClient(clientId);
  });
});

export default router;
