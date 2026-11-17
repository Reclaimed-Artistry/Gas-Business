import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDb } from '../db/database.js';
import type { UserRole } from '../services/events.js';

const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.BLUEFLAME_JWT_SECRET ||
  'blueflame-ng-production-secret-key-2026-change-in-env';
const COOKIE_NAME = 'blueflame_session';

export interface AuthUser {
  id: number;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string;
  status: string;
  avatar_url: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  if (!hash) return false;
  return bcrypt.compareSync(password, hash);
}

export function signToken(user: { id: number; role: UserRole; email: string }): string {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.VERCEL ? true : false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  if (typeof req.query.token === 'string' && req.query.token.length > 10) {
    return req.query.token;
  }
  return null;
}

export function attachOptionalUser(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    next();
    return;
  }
  (async () => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; role: UserRole };
      const db = getDb();
      const user = await db.get<AuthUser>(
        'SELECT id, role, full_name, email, phone, status, avatar_url FROM users WHERE id = ?',
        decoded.sub
      );
      if (user && user.status === 'ACTIVE') {
        req.user = user;
      }
    } catch {
      // Ignore invalid token on optional routes
    }
    next();
  })();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }
  (async () => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; role: UserRole };
      const db = getDb();
      const user = await db.get<AuthUser>(
        'SELECT id, role, full_name, email, phone, status, avatar_url FROM users WHERE id = ?',
        decoded.sub
      );
      if (!user) {
        res.status(401).json({ error: 'Session account no longer exists.' });
        return;
      }
      if (user.status !== 'ACTIVE') {
        res.status(403).json({ error: 'Your account has been suspended or deactivated. Contact support.' });
        return;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }
  })();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied. This action requires ${roles.join(' or ')} authorization.`,
      });
      return;
    }
    next();
  };
}
