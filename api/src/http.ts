import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { alertApiError } from './alerts/resend.js';
import { isAllowedOrigin } from './config.js';
import { log } from './lib/log.js';
import { metrics } from './lib/metrics.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { orderRoutes } from './routes/orders.js';
import { streamRoutes } from './routes/stream.js';
import { tokenRoutes } from './routes/tokens.js';
import { walletRoutes } from './routes/wallet.js';

export function createApp(): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    const status = String(c.res.status);
    metrics.apiRequestDuration.observe(
      { method: c.req.method, route: c.req.routePath || c.req.path, status },
      (performance.now() - start) / 1000,
    );
  });

  app.use('*', logger((message) => log.debug({ msg: message }, 'http')));
  app.use('*', cors({
    origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : ''),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Last-Event-ID', 'Cache-Control'],
    exposeHeaders: ['Content-Type', 'Cache-Control'],
    maxAge: 600,
  }));

  app.onError(async (error, c) => {
    const errorId = randomUUID();
    const status = error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status < 500
      ? error.status
      : 500;
    log.error({ err: error, errorId, path: c.req.path }, 'request failed');
    if (status >= 500) {
      // Fire-and-forget: a 5xx must return immediately even if the alert
      // backend is also stalling. The alert path has its own short-timeout pool.
      void alertApiError(c.req.path, errorId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    }
    return c.json({ error: status >= 500 ? 'internal_error' : error.message, errorId }, status as 500);
  });

  app.get('/', (c) => c.json({
    name: 'handshake-api',
    endpoints: ['/health', '/metrics', '/orders', '/tokens', '/wallet/:address/balances', '/stream'],
  }));
  app.route('/', healthRoutes);
  app.route('/', metricsRoutes);
  app.route('/', orderRoutes);
  app.route('/', tokenRoutes);
  app.route('/', walletRoutes);
  app.route('/', streamRoutes);
  return app;
}
