import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const metrics = {
  indexerBlockLag: new Gauge({
    name: 'indexer_block_lag_seconds',
    help: 'Age of the most recently indexed event per chain in seconds',
    labelNames: ['chain'] as const,
    registers: [registry],
  }),
  indexerEvents: new Counter({
    name: 'indexer_events_total',
    help: 'Accepted (deduplicated) on-chain events',
    labelNames: ['chain', 'event'] as const,
    registers: [registry],
  }),
  indexerReconnects: new Counter({
    name: 'indexer_reconnects_total',
    help: 'WebSocket reconnects per chain',
    labelNames: ['chain'] as const,
    registers: [registry],
  }),
  indexerLastEventAge: new Gauge({
    name: 'indexer_last_event_age_seconds',
    help: 'Seconds since the last accepted event on a chain',
    labelNames: ['chain'] as const,
    registers: [registry],
  }),
  rpcRequests: new Counter({
    name: 'rpc_requests_total',
    help: 'RPC requests issued by the backend',
    labelNames: ['chain', 'method'] as const,
    registers: [registry],
  }),
  dbFailures: new Counter({
    name: 'db_failures_total',
    help: 'Database operation failures',
    registers: [registry],
  }),
  outboxDepth: new Gauge({
    name: 'outbox_depth',
    help: 'Number of undelivered outbox rows',
    registers: [registry],
  }),
  sseClients: new Gauge({
    name: 'sse_clients',
    help: 'Active SSE connections',
    registers: [registry],
  }),
  sseReplays: new Counter({
    name: 'sse_replays_total',
    help: 'Last-Event-ID replays',
    registers: [registry],
  }),
  sseOverflow: new Counter({
    name: 'sse_buffer_overflow_total',
    help: 'SSE clients disconnected due to backpressure',
    registers: [registry],
  }),
  notificationEvents: new Counter({
    name: 'notification_events_total',
    help: 'Wallet-scoped notification outbox rows created',
    labelNames: ['kind'] as const,
    registers: [registry],
  }),
  walletCacheReads: new Counter({
    name: 'wallet_cache_reads_total',
    help: 'Wallet balance lookups split by cache hit/miss',
    labelNames: ['result'] as const,
    registers: [registry],
  }),
  apiRequestDuration: new Histogram({
    name: 'api_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  }),
  alertEmail: new Counter({
    name: 'alert_email_total',
    help: 'Operator alert delivery attempts',
    labelNames: ['status'] as const,
    registers: [registry],
  }),
  rcDebtWei: new Gauge({
    name: 'rc_debt_wei',
    help: 'Reactive contract debt in wei',
    registers: [registry],
  }),
  rcReservesWei: new Gauge({
    name: 'rc_reserves_wei',
    help: 'Reactive contract reserves in wei',
    registers: [registry],
  }),
  escrowDebtWei: new Gauge({
    name: 'escrow_debt_wei',
    help: 'Escrow callback-proxy debt in wei',
    labelNames: ['chain'] as const,
    registers: [registry],
  }),
  topups: new Counter({
    name: 'topups_total',
    help: 'Keeper top-up actions observed',
    labelNames: ['chain'] as const,
    registers: [registry],
  }),
};

let activeSseClients = 0;

export function incSseClients(): void {
  activeSseClients += 1;
  metrics.sseClients.inc();
}

export function decSseClients(): void {
  activeSseClients = Math.max(0, activeSseClients - 1);
  metrics.sseClients.dec();
}

export function activeSseClientCount(): number {
  return activeSseClients;
}

export async function walletCacheHitRatio(): Promise<number> {
  const all = await metrics.walletCacheReads.get();
  const hits = all.values.find((value) => value.labels.result === 'hit')?.value ?? 0;
  const misses = all.values.find((value) => value.labels.result === 'miss')?.value ?? 0;
  const total = hits + misses;
  return total === 0 ? 0 : hits / total;
}

export async function metricsText(): Promise<string> {
  metrics.outboxDepth.set(Number(await outboxDepthValue()));
  return registry.metrics();
}

let outboxDepthProvider: () => Promise<number> = async () => 0;
/** Wired by the HTTP layer so /metrics can read the real outbox depth. */
export function setOutboxDepthProvider(provider: () => Promise<number>): void {
  outboxDepthProvider = provider;
}
async function outboxDepthValue(): Promise<number> {
  try {
    return await outboxDepthProvider();
  } catch {
    return 0;
  }
}
