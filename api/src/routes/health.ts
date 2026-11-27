import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, dbPing } from '../db/client.js';
import { keeperState } from '../db/schema.js';
import { indexerStats } from '../indexer/stats.js';
import { outboxDepth } from '../indexer/ingest.js';
import { activeSseClientCount, eventLoopLagMs, walletCacheHitRatio } from '../lib/metrics.js';

export const healthRoutes = new Hono();

/** Liveness only: no DB or chain checks, so a hung loop is detectable without
 *  restarting the machine for a transient chain-subscription failure. */
healthRoutes.get('/live', (c) => c.json({
  ok: true,
  uptimeSeconds: process.uptime(),
  eventLoopLagMs: eventLoopLagMs(),
}));

healthRoutes.get('/health', async (c) => {
  const database = await dbPing();
  const [keeper] = await db.select({
    lastCheckedAt: sql<Date>`max(${keeperState.lastCheckedAt})`,
  }).from(keeperState);
  const indexer = indexerStats.all();
  const lastEventAgeMs = indexerStats.maxLastEventAgeMs();
  const depth = await outboxDepth();
  const keeperFreshnessMs = keeper?.lastCheckedAt ? Date.now() - new Date(keeper.lastCheckedAt).getTime() : null;
  const ok = database && indexer.every((chain) => chain.status === 'live' || chain.status === 'connecting');
  return c.json({
    ok,
    database,
    indexer,
    lastEventAgeMs,
    keeperFreshnessMs,
    subscriptionCount: indexerStats.totalSubscriptions(),
    outboxDepth: depth,
    walletCacheHitRatio: await walletCacheHitRatio(),
    uptimeSeconds: process.uptime(),
    metrics: {
      sseClients: activeSseClientCount(),
    },
  }, ok ? 200 : 503);
});
