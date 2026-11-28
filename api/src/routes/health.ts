import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, dbPing } from '../db/client.js';
import { keeperState, outbox } from '../db/schema.js';
import { indexerStats } from '../indexer/stats.js';
import { activeSseClientCount, eventLoopLagMs, walletCacheHitRatio } from '../lib/metrics.js';

export const healthRoutes = new Hono();

/** Health must answer quickly even when a (separate) pool is stalling. The
 *  underlying query keeps its own pool timeout; we simply stop waiting. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/** Liveness only: no DB or chain checks, so a hung loop is detectable without
 *  restarting the machine for a transient chain-subscription failure. */
healthRoutes.get('/live', (c) => c.json({
  ok: true,
  uptimeSeconds: process.uptime(),
  eventLoopLagMs: eventLoopLagMs(),
}));

healthRoutes.get('/health', async (c) => {
  const ping = await withDeadline(dbPing(), 3_000);
  const keeperRows = await withDeadline(db.select({
    lastCheckedAt: sql<Date>`max(${keeperState.lastCheckedAt})`,
  }).from(keeperState), 3_000);
  // Outbox depth must reflect the user-facing (request) pool, not the
  // background pool that the indexer may be stalling.
  const depth = await withDeadline(
    db.select({ count: sql<number>`count(*)::int` }).from(outbox)
      .where(sql`${outbox.deliveredAt} is null`)
      .then((rows) => rows[0]?.count ?? 0),
    3_000,
  );
  const database = ping === true && keeperRows !== undefined && depth !== undefined;
  const keeper = keeperRows?.[0];
  const indexer = indexerStats.all();
  const lastEventAgeMs = indexerStats.maxLastEventAgeMs();
  const keeperFreshnessMs = keeper?.lastCheckedAt ? Date.now() - new Date(keeper.lastCheckedAt).getTime() : null;
  // `live` requires an actual subscription; HTTP gap-fill alone is reported as
  // `gapFillOnly` and must not make the service look healthy.
  const ok = database && indexer.every((chain) =>
    chain.status === 'connecting' || (chain.status === 'live' && chain.subscriptions > 0));
  return c.json({
    ok,
    database,
    indexer,
    lastEventAgeMs,
    keeperFreshnessMs,
    subscriptionCount: indexerStats.totalSubscriptions(),
    outboxDepth: depth ?? -1,
    walletCacheHitRatio: await walletCacheHitRatio(),
    uptimeSeconds: process.uptime(),
    metrics: {
      sseClients: activeSseClientCount(),
    },
  }, ok ? 200 : 503);
});
