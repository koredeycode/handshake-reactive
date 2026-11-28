import { lt, sql } from 'drizzle-orm';
import { env, httpUrlFor, wsUrlFor } from '../config.js';
import { CHAIN_CONFIGS, CURATED_TOKENS, DEPLOYMENTS } from '../contracts.js';
import { backgroundDb as db } from './client.js';
import { alertDeliveries, chains, keeperActions, orderEvents, outbox, tokens, venues, walletCache } from './schema.js';
import { log } from '../lib/log.js';

/** Seeds static chain/venue/token catalogues. Never touches contracts. */
export async function bootstrapDatabase(): Promise<void> {
  await db.insert(chains).values(CHAIN_CONFIGS.map((chain) => ({
    id: chain.chainId,
    name: chain.name,
    rpcUrl: httpUrlFor(chain.chainId),
    wsUrl: wsUrlFor(chain.chainId),
    explorer: chain.explorer,
    callbackProxy: chain.callbackProxy ?? null,
    logChunkSize: chain.logChunkSize,
  }))).onConflictDoUpdate({
    target: chains.id,
    set: {
      rpcUrl: sqlSet('rpc_url'),
      wsUrl: sqlSet('ws_url'),
    },
  }).catch(async (error) => {
    // Fallback for providers where onConflictDoUpdate needs explicit values.
    log.warn({ err: error }, 'chains upsert fallback');
    for (const chain of CHAIN_CONFIGS) {
      await db.insert(chains).values({
        id: chain.chainId, name: chain.name, rpcUrl: httpUrlFor(chain.chainId),
        wsUrl: wsUrlFor(chain.chainId), explorer: chain.explorer,
        callbackProxy: chain.callbackProxy ?? null, logChunkSize: chain.logChunkSize,
      }).onConflictDoNothing();
    }
  });

  for (const chain of CHAIN_CONFIGS) {
    if (!chain.paymentEscrow || !chain.assetEscrow) continue;
    await db.insert(venues).values({
      chainId: chain.chainId,
      paymentEscrow: chain.paymentEscrow,
      assetEscrow: chain.assetEscrow,
    }).onConflictDoNothing({ target: [venues.chainId, venues.paymentEscrow, venues.assetEscrow] });
  }

  await db.insert(tokens).values(CURATED_TOKENS.map((token) => ({
    chainId: token.chainId, address: token.address, verified: true, source: 'curated',
  }))).onConflictDoNothing({ target: [tokens.chainId, tokens.address] });

  log.info({ chains: CHAIN_CONFIGS.length, curatedTokens: CURATED_TOKENS.length }, 'catalogue bootstrapped');
}

// Helper for assigning the incoming values in the upsert above without
// repeating the whole map; drizzle accepts SQL expressions in `set`.
function sqlSet(column: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return sql`excluded.${sql.raw(column)}`;
}
export async function pruneExpiredRows(): Promise<void> {
  const now = Date.now();
  await db.delete(outbox).where(lt(outbox.createdAt, new Date(now - env.OUTBOX_RETENTION_DAYS * 86_400_000)));
  // Proof bundles live in docs/, so the DB is only a short-lived projection:
  // keep order events for 14 days rather than the old 90-day window.
  await db.delete(orderEvents).where(lt(orderEvents.receivedAt, new Date(now - 14 * 86_400_000)));
  await db.delete(keeperActions).where(lt(keeperActions.at, new Date(now - 30 * 86_400_000)));
  await db.delete(alertDeliveries).where(lt(alertDeliveries.createdAt, new Date(now - 30 * 86_400_000)));
  await db.delete(walletCache).where(lt(walletCache.fetchedAt, new Date(now - 86_400_000)));
  log.debug('retention sweep complete');
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startRetention(): void {
  if (timer) return;
  void pruneExpiredRows().catch((error) => log.error({ err: error }, 'initial retention sweep failed'));
  timer = setInterval(() => void pruneExpiredRows().catch((error) => log.error({ err: error }, 'retention sweep failed')), 60 * 60_000);
  timer.unref();
}

export function stopRetention(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

export const STATIC_ADDRESSES = DEPLOYMENTS;
