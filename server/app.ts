import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { getDb } from './db/database.js';
import { seedDatabaseIfEmpty } from './db/seed.js';
import { isSupabaseAuthEnabled, isSupabaseDbEnabled } from './lib/supabase.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import customerRoutes from './routes/customer.js';
import paymentRoutes from './routes/payments.js';
import dispatcherRoutes from './routes/dispatcher.js';
import adminRoutes from './routes/admin.js';

let initPromise: Promise<void> | null = null;
function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      getDb();
      await seedDatabaseIfEmpty();
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

// Ensure DB schema & seed initialized before handling any request
app.use((_req, _res, next) => {
  ensureInitialized()
    .then(() => next())
    .catch(next);
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    platform: 'BlueFlame Cooking Gas Marketplace · Uyo, Akwa Ibom',
    database: isSupabaseDbEnabled() ? 'supabase-postgresql (blueflame)' : 'local-sqlite',
    googleAuth: isSupabaseAuthEnabled() ? 'supabase-google-oauth' : 'disabled',
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-server',
    timestamp: new Date().toISOString(),
  });
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/dispatcher', dispatcherRoutes);
app.use('/api/admin', adminRoutes);

// Explicitly return 403 if anyone probes forbidden retailer registration/login endpoints
app.all(['/api/retailer/*', '/api/vendor/*'], (_req, res) => {
  res.status(403).json({
    error:
      'Retailers do not have self-service accounts or dashboards. All retailers are centrally managed by BlueFlame Operations.',
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[BlueFlame API Error]', err);
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
});

export default app;
