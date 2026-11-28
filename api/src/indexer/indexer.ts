import { eq, sql } from 'drizzle-orm';
import {
  createPublicClient,
  http,
  toHex,
  webSocket,
  type Address,
  type Hex,
} from 'viem';
import { env, httpUrlFor, wsUrlFor } from '../config.js';
import { CHAIN_CONFIGS, REACTIVE_CONTRACT, type ChainConfig } from '../contracts.js';
import { backgroundDb as db } from '../db/client.js';
import { indexerState } from '../db/schema.js';
import { alertWsFailure, formatError } from '../alerts/resend.js';
import { log } from '../lib/log.js';
import { metrics } from '../lib/metrics.js';
import { backoffDelay, isRateLimitError, withRetry } from '../lib/retry.js';
import { decodeRawLog, type DecodedEvent, type RawLog } from './decode.js';
import {
  emitTransferBalances,
  flushAllIndexerStatus,
  handleReorg,
  ingestLog,
  reconcilePartialOrderTerms,
  updateIndexerStatus,
} from './ingest.js';
import { indexerStats } from './stats.js';

type WsClient = ReturnType<typeof createWsClient>;
type HttpClient = ReturnType<typeof createHttpClient>;

function createWsClient(url: string) {
  return createPublicClient({
    transport: webSocket(url, { reconnect: { attempts: 10, delay: 2_000 } }),
    pollingInterval: 1_000,
  });
}

function createHttpClient(url: string) {
  return createPublicClient({ transport: http(url) });
}

const httpClients = new Map<number, HttpClient>(
  CHAIN_CONFIGS.map((chain) => [chain.chainId, createHttpClient(httpUrlFor(chain.chainId))]),
);
const wsClients = new Map<number, WsClient>();
const subscriptions = new Map<number, { unsubscribe: () => Promise<unknown> }>();
const backfilling = new Set<number>();
/** Tracked fire-and-forget gap fills so shutdown can wait for their DB work. */
const backfillTasks = new Set<Promise<void>>();
const reconcileTimers = new Map<number, ReturnType<typeof setTimeout>>();
let started = false;
let stopping = false;

/** Launch a gap fill that shutdown will drain before the pg pool is closed. */
function runBackfill(chain: ChainConfig): void {
  if (stopping) return;
  const task = backfill(chain);
  backfillTasks.add(task);
  void task.finally(() => {
    backfillTasks.delete(task);
  }).catch((error) => {
    log.error({ err: error, chainId: chain.chainId }, 'backfill task rejected');
  });
}

/** HTTP gap-fill progress is not a live subscription. Never report it as one:
 *  otherwise /health says a chain is healthy while nothing is delivering events. */
function markGapFillProgress(chainId: number): void {
  // A subscription object still exists during viem's internal reconnect; a
  // successful gap-fill proves we are receiving data, so restore `live`.
  // Only chains that truly have no subscription are gap-fill-only.
  const subscribed = subscriptions.has(chainId) && (indexerStats.get(chainId)?.subscriptions ?? 0) > 0;
  if (subscribed) {
    if (indexerStats.get(chainId)?.status !== 'live') indexerStats.set(chainId, { status: 'live' });
  } else {
    indexerStats.set(chainId, { status: 'gapFillOnly' });
  }
}

function isRangeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : formatError(error).toLowerCase();
  return message.includes('range') || message.includes('too many') || message.includes('block not found');
}

/**
 * CallbackRequest is emitted by the system contract for every subscriber, not
 * just ours. The payload's orderId belongs to the subscriber that requested it,
 * so a foreign subscriber must never become one of our orders.
 */
function isForeignCallback(event: DecodedEvent): boolean {
  if (event.name !== 'callbackRequest') return false;
  const subscriber = typeof event.fields.subscriber === 'string'
    ? event.fields.subscriber.toLowerCase()
    : undefined;
  return subscriber !== REACTIVE_CONTRACT.toLowerCase();
}

async function handleLog(chain: ChainConfig, raw: RawLog): Promise<void> {
  const event = decodeRawLog(raw, chain.chainId);
  if (!event || isForeignCallback(event)) return;
  try {
    // Cron100 is a liveness heartbeat, not event history: never persist an
    // order_events row, publish to the bus or fold it into an order. Ignore
    // removed cron logs entirely so a reorg cannot corrupt indexer state.
    if (event.name === 'cron100') {
      if (event.removed) return;
      await updateIndexerStatus(chain.chainId, 'live', event.blockNumber, event.blockHash);
    } else if (event.removed) {
      await handleReorg(event);
    } else if (event.name === 'transfer') {
      await emitTransferBalances(event);
    } else {
      await ingestLog(event);
    }
    const now = Date.now();
    // An event replayed by gap-fill proves history, not a live subscription.
    // Only a subscribed chain may report `live`.
    const subscribed = subscriptions.has(chain.chainId)
      && (indexerStats.get(chain.chainId)?.subscriptions ?? 0) > 0;
    indexerStats.set(chain.chainId, {
      status: subscribed ? 'live' : 'gapFillOnly',
      lastEventAt: now,
      lastBlock: Math.max(indexerStats.get(chain.chainId)?.lastBlock ?? 0, event.blockNumber),
    });
    metrics.indexerLastEventAge.set({ chain: String(chain.chainId) }, 0);
    metrics.indexerBlockLag.set({ chain: String(chain.chainId) }, 0);
  } catch (error) {
    log.error({ err: error, chainId: chain.chainId, txHash: event.txHash }, 'log handling failed');
    throw error;
  }
}

/** Bounded HTTP eth_getLogs gap fill; one subscription but many chunked requests. */
export async function backfill(chain: ChainConfig): Promise<void> {
  if (stopping || backfilling.has(chain.chainId)) return;
  backfilling.add(chain.chainId);
  const client = httpClients.get(chain.chainId)!;
  const method = 'eth_getLogs';
  try {
    const headRaw = await withRetry(async () => {
      metrics.rpcRequests.inc({ chain: String(chain.chainId), method: 'eth_blockNumber' });
      return client.request({ method: 'eth_blockNumber' });
    }, {
      label: `blockNumber:${chain.chainId}`,
      onRetry: (error, attempt, delay) => log.warn({ err: error, chainId: chain.chainId, attempt, delay }, 'blockNumber retry'),
    });
    const head = Number(headRaw);
    const [state] = await db.select().from(indexerState).where(eq(indexerState.chainId, chain.chainId)).limit(1);
    const startOverride = env[`START_BLOCK_${chain.chainId}` as keyof typeof env];
    let from = state && state.lastBlock > 0
      ? state.lastBlock + 1
      : typeof startOverride === 'number'
        ? startOverride
        : Math.max(0, head - Math.max(1_000, chain.logChunkSize * 5));
    if (from > head) from = head;
    let chunk = chain.logChunkSize;
    let scanned = 0;
    let failed = false;
    while (from <= head) {
      if (stopping) break;
      const to = Math.min(head, from + chunk - 1);
      try {
        const logs = await withRetry(async () => {
          metrics.rpcRequests.inc({ chain: String(chain.chainId), method });
          const result = await client.request({
            method: 'eth_getLogs',
            params: [{
              fromBlock: toHex(BigInt(from)),
              toBlock: toHex(BigInt(to)),
              address: chain.addresses as Address[],
              topics: [chain.topic0s as Hex[]],
            }],
          });
          return (result ?? []) as RawLog[];
        }, {
          label: `getLogs:${chain.chainId}`,
          isRangeError,
          onRetry: (error, attempt, delay) => {
            log.warn({ err: error, chainId: chain.chainId, attempt, delay, from, to }, 'getLogs retry');
            if (isRateLimitError(error)) alertWsFailure(chain.chainId, `getLogs rate limited: ${formatError(error)}`).catch(() => undefined);
          },
        });
        if (stopping) break;
        let lastGoodBlock = from - 1;
        for (const raw of logs) {
          if (stopping) break;
          try {
            await handleLog(chain, raw);
            lastGoodBlock = Math.max(lastGoodBlock, Number(raw.blockNumber ?? 0));
          } catch (error) {
            // Stop this chunk at the first bad log and never commit a cursor
            // past it: the reconcile loop must replay it.
            failed = true;
            log.warn({
              err: error,
              chainId: chain.chainId,
              txHash: raw.transactionHash ?? null,
              blockNumber: Number(raw.blockNumber ?? 0),
            }, 'backfill log failed; cursor will not advance past this block');
            break;
          }
        }
        if (stopping) break;
        if (failed) {
          if (lastGoodBlock >= from) {
            await updateIndexerStatus(chain.chainId, 'live', lastGoodBlock);
            markGapFillProgress(chain.chainId);
          }
          break;
        }
        await updateIndexerStatus(chain.chainId, 'live', to);
        markGapFillProgress(chain.chainId);
        scanned += logs.length;
        from = to + 1;
        // The provider may accept larger ranges once a few calls succeed.
        if (!stopping && chunk < chain.logChunkSize && scanned === 0 && from % (chunk * 4) === 0) {
          chunk = Math.min(chain.logChunkSize, chunk * 2);
        }
      } catch (error) {
        if (isRangeError(error) && chunk > 50) {
          chunk = Math.max(50, Math.floor(chunk / 2));
          continue;
        }
        throw error;
      }
    }
    const lastEventAt = indexerStats.get(chain.chainId)?.lastEventAt ?? 0;
    metrics.indexerBlockLag.set({
      chain: String(chain.chainId),
    }, lastEventAt > 0 ? (Date.now() - lastEventAt) / 1000 : 0);
    if (failed) {
      log.warn({ chainId: chain.chainId, from, head, chunk, scanned }, 'gap backfill stopped at failed log; reconcile will retry');
    } else if (stopping) {
      log.warn({ chainId: chain.chainId, from, head, chunk, scanned }, 'gap backfill paused during shutdown');
    } else {
      log.info({ chainId: chain.chainId, from, head, chunk, scanned }, 'gap backfill complete');
    }
  } catch (error) {
    log.error({ err: error, chainId: chain.chainId }, 'gap backfill failed');
    await alertWsFailure(chain.chainId, `Gap backfill failed: ${formatError(error)}`).catch(() => undefined);
  } finally {
    backfilling.delete(chain.chainId);
  }
}

async function onWsError(chain: ChainConfig, error: unknown): Promise<void> {
  metrics.indexerReconnects.inc({ chain: String(chain.chainId) });
  indexerStats.set(chain.chainId, {
    status: 'reconnecting',
    reconnectCount: (indexerStats.get(chain.chainId)?.reconnectCount ?? 0) + 1,
  });
  await db.update(indexerState).set({
    status: 'reconnecting',
    reconnectCount: sql`${indexerState.reconnectCount} + 1`,
    updatedAt: new Date(),
  }).where(eq(indexerState.chainId, chain.chainId)).catch(() => undefined);
  const message = formatError(error);
  log.warn({ err: error, chainId: chain.chainId, message }, 'WebSocket error; gap fill queued');
  // Public RPCs close idle sockets routinely. Reconnect + gap-fill handle those,
  // so only email on a real failure (or if the gap-fill itself later fails).
  if (!/socket.*closed|websocket.*closed|socketclosed/i.test(message)) {
    await alertWsFailure(chain.chainId, `WS error: ${message}`);
  }
  // viem reconnects + re-subscribes internally; replay anything missed since
  // the last committed block once the socket has had time to come back.
  setTimeout(() => runBackfill(chain), backoffDelay(1, 1_000, 3_000)).unref();
}

export async function startIndexer(): Promise<void> {
  if (started) return;
  stopping = false;
  started = true;
  // Repair pre-existing partial rows once per process; failure is non-fatal.
  const reconciliation = reconcilePartialOrderTerms();
  backfillTasks.add(reconciliation);
  void reconciliation.finally(() => backfillTasks.delete(reconciliation)).catch((error) => {
    log.warn({ err: error }, 'partial terms reconciliation task rejected');
  });
  for (const chain of CHAIN_CONFIGS) {
    try {
      await updateIndexerStatus(chain.chainId, 'connecting');
      const client = createWsClient(wsUrlFor(chain.chainId));
      wsClients.set(chain.chainId, client);
      const subscription = await client.transport.subscribe({
        params: ['logs', { address: chain.addresses, topics: [chain.topic0s] }],
        onData: (data) => {
          if (stopping) return;
          const logData = (data as { result?: RawLog }).result;
          if (logData) void handleLog(chain, logData).catch((error) => {
            log.error({ err: error, chainId: chain.chainId }, 'subscription log failed');
          });
        },
        onError: (error) => void onWsError(chain, error),
      });
      subscriptions.set(chain.chainId, subscription);
      indexerStats.set(chain.chainId, { status: 'live', subscriptions: 1 });
      log.info({
        chainId: chain.chainId, name: chain.name, addresses: chain.addresses.length, topics: chain.topic0s.length,
      }, 'subscribed to logs');
      runBackfill(chain);
    } catch (error) {
      // A dead provider must not prevent the HTTP API from starting.
      indexerStats.set(chain.chainId, { status: 'error', subscriptions: 0 });
      log.error({ err: error, chainId: chain.chainId }, 'chain subscription failed');
      await alertWsFailure(chain.chainId, `Subscription failed: ${formatError(error)}`).catch(() => undefined);
      runBackfill(chain);
    }
  }
  const socketOpened = (chain: ChainConfig) => {
    // A socket opening does not mean we are subscribed. Lasna in particular
    // opens a socket and then fails the logs subscription when the RC is idle.
    const subscribed = subscriptions.has(chain.chainId)
      && (indexerStats.get(chain.chainId)?.subscriptions ?? 0) > 0;
    indexerStats.set(chain.chainId, { status: subscribed ? 'live' : 'gapFillOnly' });
  };
  for (const chain of CHAIN_CONFIGS) {
    const client = wsClients.get(chain.chainId);
    if (!client) continue;
    void client.transport.getRpcClient().then((rpc) => {
      rpc.socket.addEventListener?.('open', () => socketOpened(chain));
      rpc.socket.addEventListener?.('close', () => {
        // viem reopens the socket internally. Only a lost subscription (not a
        // routine public-RPC socket close) is genuinely gap-fill-only.
        if (!subscriptions.has(chain.chainId)) {
          indexerStats.set(chain.chainId, { status: 'gapFillOnly' });
        }
      });
    }).catch(() => undefined);
  }
  // Stagger chains and add jitter so four reconciles never hit the DB at once.
  // Lasna has no working WSS subscription, so it reconciles every minute.
  CHAIN_CONFIGS.forEach((chain, index) => scheduleReconcile(chain, index));
}

function scheduleReconcile(chain: ChainConfig, index: number): void {
  const intervalMs = chain.chainId === 5318007 ? 60_000 : 5 * 60_000;
  const delay = intervalMs + index * 15_000 + Math.floor(Math.random() * 15_000);
  const timer = setTimeout(() => {
    reconcileTimers.delete(chain.chainId);
    if (stopping) return;
    runBackfill(chain);
    scheduleReconcile(chain, index);
  }, delay);
  reconcileTimers.set(chain.chainId, timer);
  timer.unref();
}

export async function stopIndexer(): Promise<void> {
  // Signal first so no new gap fill or log can start while the pool is alive,
  // then drain the ones already in flight before index.ts closes the DB.
  stopping = true;
  for (const timer of reconcileTimers.values()) clearTimeout(timer);
  reconcileTimers.clear();
  for (const [chainId, subscription] of subscriptions) {
    await subscription.unsubscribe().catch(() => undefined);
    indexerStats.set(chainId, { subscriptions: 0, status: 'connecting' });
  }
  subscriptions.clear();
  for (const client of wsClients.values()) {
    await client.transport.getRpcClient().then((rpc) => rpc.close()).catch(() => undefined);
  }
  wsClients.clear();
  await Promise.allSettled([...backfillTasks]);
  backfillTasks.clear();
  await Promise.allSettled(flushAllIndexerStatus());
  started = false;
}
