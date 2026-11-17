import { isDisabledDemoAccount } from '../middleware/auth.js';
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
import { asyncHandler } from '../lib/asyncHandler.js';
import { getSupabaseAdmin, isSupabaseAuthEnabled } from '../lib/supabase.js';

const router = Router();

router.get('/config', (_req, res) => {
  res.json({
    googleAuthEnabled: isSupabaseAuthEnabled(),
    supabaseBackendEnabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.USE_LOCAL_SQLITE !== '1'),
  });
});

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
router.post(
  '/register',
  asyncHandler(async (req, res) => {
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
    const normalizedEmail = email.trim().toLowerCase();
    const db = getDb();
    const existing = await db.get<{ id: number }>('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email address already exists.' });
      return;
    }

    const created = await runInTransaction(async (tdb) => {
      const hash = hashPassword(password);
      const info = await tdb.run(
        `
        INSERT INTO users (role, full_name, email, phone, password_hash, status)
        VALUES ('CUSTOMER', ?, ?, ?, ?, 'ACTIVE')
      `,
        fullName.trim(),
        normalizedEmail,
        phone.trim(),
        hash
      );
      const userId = Number(info.lastInsertRowid);
      await tdb.run('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, 0)', userId);
      return {
        id: userId,
        role: 'CUSTOMER' as const,
        full_name: fullName.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        status: 'ACTIVE',
        avatar_url: null,
      };
    });

    const token = signToken(created);
    setAuthCookie(res, token);
    res.status(201).json({ user: created, token, walletBalanceKobo: 0 });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please provide a valid email and password.' });
      return;
    }

    const db = getDb();
    const user = await db.get<{
      id: number;
      role: 'CUSTOMER' | 'DISPATCHER' | 'ADMIN';
      full_name: string;
      email: string;
      phone: string;
      password_hash: string;
      status: string;
      avatar_url: string | null;
    }>(
      'SELECT id, role, full_name, email, phone, password_hash, status, avatar_url FROM users WHERE LOWER(email) = LOWER(?)',
      parsed.data.email.trim().toLowerCase()
    );

    if (!user || isDisabledDemoAccount(user.email) || !verifyPassword(parsed.data.password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email address or password.' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'This account is currently suspended or inactive. Contact Operations.' });
      return;
    }

    const userId = Number(user.id);
    const token = signToken({ id: userId, role: user.role, email: user.email });
    setAuthCookie(res, token);

    let walletBalanceKobo: number | undefined;
    let dispatcherProfile: unknown;
    if (user.role === 'CUSTOMER') {
      walletBalanceKobo = (await ensureWalletForUser(userId)).balance_kobo;
    } else if (user.role === 'DISPATCHER') {
      dispatcherProfile = await db.get('SELECT * FROM dispatcher_profiles WHERE user_id = ?', userId);
    }

    res.json({
      user: {
        id: userId,
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
  })
);

/**
 * Supabase Google OAuth Session Exchange:
 * Independently verifies the Supabase access token server-side via supabaseAdmin.auth.getUser(),
 * links any matching existing account, or auto-provisions a CUSTOMER-only account + wallet.
 */
router.post(
  '/supabase-exchange',
  asyncHandler(async (req, res) => {
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!accessToken || accessToken.length < 20) {
      res.status(400).json({ error: 'Valid Supabase access token is required.' });
      return;
    }

    if (!isSupabaseAuthEnabled()) {
      res.status(503).json({ error: 'Google sign-in via Supabase is not configured on this server.' });
      return;
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data?.user || !data.user.email) {
      res.status(401).json({ error: 'Google sign-in could not be verified. Please try signing in again.' });
      return;
    }

    const supaUser = data.user;
    const authUserId = supaUser.id;
    const email = supaUser.email!.trim().toLowerCase();
    const meta = (supaUser.user_metadata || {}) as Record<string, unknown>;
    const fullName =
      String(meta.full_name || meta.name || email.split('@')[0] || 'Gasflo Customer').trim().slice(0, 120);
    const avatarUrl =
      typeof meta.avatar_url === 'string'
        ? meta.avatar_url
        : typeof meta.picture === 'string'
        ? meta.picture
        : null;

    const db = getDb();
    let user = await db.get<{
      id: number;
      auth_user_id: string | null;
      role: 'CUSTOMER' | 'DISPATCHER' | 'ADMIN';
      full_name: string;
      email: string;
      phone: string;
      status: string;
      avatar_url: string | null;
    }>(
      'SELECT id, auth_user_id, role, full_name, email, phone, status, avatar_url FROM users WHERE auth_user_id = ? OR LOWER(email) = LOWER(?) LIMIT 1',
      authUserId,
      email
    );

    let isNewUser = false;

    if (user) {
      if (user.status !== 'ACTIVE') {
        res.status(403).json({ error: 'This account is currently suspended or inactive. Contact Operations.' });
        return;
      }
      if (!user.auth_user_id || (!user.avatar_url && avatarUrl)) {
        await db.run(
          `UPDATE users SET auth_user_id = COALESCE(auth_user_id, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = datetime('now') WHERE id = ?`,
          authUserId,
          avatarUrl,
          user.id
        );
        user = {
          ...user,
          auth_user_id: user.auth_user_id || authUserId,
          avatar_url: user.avatar_url || avatarUrl,
        };
      }
    } else {
      isNewUser = true;
      const randomSecret = hashPassword(crypto.randomBytes(24).toString('hex'));
      user = await runInTransaction(async (tdb) => {
        const info = await tdb.run(
          `
          INSERT INTO users (auth_user_id, role, full_name, email, phone, password_hash, avatar_url, status)
          VALUES (?, 'CUSTOMER', ?, ?, '', ?, ?, 'ACTIVE')
        `,
          authUserId,
          fullName,
          email,
          randomSecret,
          avatarUrl
        );
        const newUserId = Number(info.lastInsertRowid);
        await tdb.run('INSERT INTO wallets (user_id, balance_kobo) VALUES (?, 0)', newUserId);
        return {
          id: newUserId,
          auth_user_id: authUserId,
          role: 'CUSTOMER' as const,
          full_name: fullName,
          email,
          phone: '',
          status: 'ACTIVE',
          avatar_url: avatarUrl,
        };
      });
    }

    const userId = Number(user.id);
    const token = signToken({ id: userId, role: user.role, email: user.email });
    setAuthCookie(res, token);

    let walletBalanceKobo: number | undefined;
    let dispatcherProfile: unknown;
    if (user.role === 'CUSTOMER') {
      walletBalanceKobo = (await ensureWalletForUser(userId)).balance_kobo;
    } else if (user.role === 'DISPATCHER') {
      dispatcherProfile = await db.get('SELECT * FROM dispatcher_profiles WHERE user_id = ?', userId);
    }

    res.json({
      user: {
        id: userId,
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
      isNewUser,
    });
  })
);

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = req.user!;
    const userId = Number(user.id);
    let walletBalanceKobo: number | undefined;
    let dispatcherProfile: unknown;
    if (user.role === 'CUSTOMER') {
      walletBalanceKobo = (await ensureWalletForUser(userId)).balance_kobo;
    } else if (user.role === 'DISPATCHER') {
      dispatcherProfile = await db.get('SELECT * FROM dispatcher_profiles WHERE user_id = ?', userId);
    }
    const unreadRow = await db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0',
      userId
    );

    res.json({
      user,
      walletBalanceKobo,
      dispatcherProfile,
      unreadNotifications: Number(unreadRow?.cnt || 0),
    });
  })
);

router.patch(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
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
    const userId = Number(req.user!.id);

    if (parsed.data.newPassword) {
      const row = await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId);
      if (!row || !parsed.data.currentPassword || !verifyPassword(parsed.data.currentPassword, row.password_hash)) {
        res.status(400).json({ error: 'Current password is incorrect.' });
        return;
      }
      await db.run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, hashPassword(parsed.data.newPassword), userId);
    }

    if (parsed.data.fullName || parsed.data.phone) {
      await db.run(
        `
        UPDATE users
        SET full_name = COALESCE(?, full_name),
            phone = COALESCE(?, phone),
            updated_at = datetime('now')
        WHERE id = ?
      `,
        parsed.data.fullName?.trim() ?? null,
        parsed.data.phone?.trim() ?? null,
        userId
      );
    }

    const updated = await db.get(
      'SELECT id, role, full_name, email, phone, status, avatar_url FROM users WHERE id = ?',
      userId
    );
    res.json({ user: updated });
  })
);

router.get(
  '/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const notifications = await db.all(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60',
      req.user!.id
    );
    const unreadRow = await db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0',
      req.user!.id
    );
    res.json({ notifications, unreadCount: Number(unreadRow?.cnt || 0) });
  })
);

router.patch(
  '/notifications/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    await db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', Number(req.params.id), req.user!.id);
    res.json({ ok: true });
  })
);

router.post(
  '/notifications/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user!.id);
    res.json({ ok: true });
  })
);

router.get('/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = crypto.randomUUID();
  registerSseClient(clientId, Number(req.user!.id), req.user!.role, res);
  res.write(`retry: 8000\nevent: connected\ndata: ${JSON.stringify({ userId: req.user!.id, role: req.user!.role })}\n\n`);

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
