import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { Resend } from 'resend';
import { createPublicClient, http } from 'viem';
import { env, httpUrlFor } from '../config.js';
import { REACTIVE_CONTRACT, SYSTEM_CONTRACT, systemReadAbi } from '../contracts.js';
import { alertDb as db } from '../db/client.js';
import { alertDeliveries, keeperState, outbox } from '../db/schema.js';
import { bus, type PublishedEvent } from '../lib/bus.js';
import type { SseEventType } from '../lib/events.js';
import { log } from '../lib/log.js';
import { metrics } from '../lib/metrics.js';
import { backoffDelay } from '../lib/retry.js';
import { indexerStats } from '../indexer/stats.js';

/**
 * Operator-only error alerts. User notifications never leave the SSE stream;
 * no user email addresses are read, stored or sent anywhere in this backend.
 */
let resend: Resend | undefined;
function client(): Resend | undefined {
  if (!env.RESEND_API_KEY) return undefined;
  resend ??= new Resend(env.RESEND_API_KEY);
  return resend;
}

export type AlertInput = {
  kind: string;
  subject: string;
  body: string;
  dedupeKey?: string;
};

/** viem/WebSocket errors are often ErrorEvent wrappers: String(error) gives
 *  "[object ErrorEvent]" and loses the actual message. */
export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      error?: { message?: unknown; name?: unknown };
    };
    const inner = candidate.error;
    if (inner) {
      if (inner instanceof Error) return inner.message || inner.name;
      if (typeof inner.message === 'string' && inner.message.length > 0) return inner.message;
      if (typeof inner.name === 'string' && inner.name.length > 0) return inner.name;
    }
    if (typeof candidate.message === 'string' && candidate.message.length > 0) return candidate.message;
  }
  return String(error);
}

/** DB-free cooldown so an alert storm during a Supabase stall cannot refill the inbox. */
const recentMemory = new Map<string, number>();

function dedupeWindowMs(kind: string): number {
  // WebSocket closes are expected with public RPCs; keep their alert cooldown
  // longer than the generic window to avoid inbox spam.
  return kind === 'indexer_ws' ? Math.max(env.ALERT_DEDUPE_MS, 30 * 60_000) : env.ALERT_DEDUPE_MS;
}

/**
 * Seed the in-memory guard with alerts sent before this process started. A
 * restart (or Fly redeploy) must not reopen a cooldown that is still active in
 * `alert_deliveries`; the DB lookup remains the authoritative dedupe check.
 */
async function hydrateAlertCooldowns(): Promise<void> {
  const since = new Date(Date.now() - dedupeWindowMs('indexer_ws'));
  const rows = await db.select({
    kind: alertDeliveries.kind,
    dedupeKey: alertDeliveries.dedupeKey,
    createdAt: alertDeliveries.createdAt,
  }).from(alertDeliveries).where(and(
    gt(alertDeliveries.createdAt, since),
    inArray(alertDeliveries.status, ['sent', 'pending']),
  )).orderBy(desc(alertDeliveries.createdAt)).limit(1000);
  for (const row of rows) {
    const at = new Date(row.createdAt).getTime();
    if (!Number.isFinite(at)) continue;
    const key = `${row.kind}:${row.dedupeKey}`;
    if (at > (recentMemory.get(key) ?? 0)) recentMemory.set(key, at);
  }
  log.info({ hydrated: rows.length }, 'hydrated operator alert cooldowns from alert deliveries');
}

export async function sendOperatorAlert(input: AlertInput): Promise<void> {
  const mailer = client();
  if (!mailer || !env.OPERATOR_ALERT_EMAIL) {
    // No credentials (or no recipient): logs are the only alert channel.
    log.warn({ kind: input.kind, subject: input.subject }, 'operator alert (Resend not configured)');
    metrics.alertEmail.inc({ status: 'skipped', kind: input.kind });
    return;
  }
  const dedupeKey = input.dedupeKey ?? input.subject;
  const windowMs = dedupeWindowMs(input.kind);
  const memoryKey = `${input.kind}:${dedupeKey}`;
  const lastMemory = recentMemory.get(memoryKey) ?? 0;
  if (Date.now() - lastMemory < windowMs) {
    log.info({ kind: input.kind, dedupeKey }, 'operator alert deduped (memory)');
    return;
  }

  // Dedupe and bookkeeping are on the dedicated alert pool and are strictly
  // best-effort: a DB outage must never suppress the email itself.
  let rowId: number | undefined;
  try {
    const since = new Date(Date.now() - windowMs);
    const recent = await db.select({ id: alertDeliveries.id }).from(alertDeliveries)
      .where(and(
        eq(alertDeliveries.kind, input.kind),
        eq(alertDeliveries.dedupeKey, dedupeKey),
        gt(alertDeliveries.createdAt, since),
        inArray(alertDeliveries.status, ['sent', 'pending']),
      ))
      .limit(1);
    if (recent.length > 0) {
      log.info({ kind: input.kind, dedupeKey }, 'operator alert deduped (database)');
      return;
    }
    const [row] = await db.insert(alertDeliveries).values({
      kind: input.kind, dedupeKey, subject: input.subject, status: 'pending', attempts: 0,
    }).returning({ id: alertDeliveries.id });
    rowId = row?.id;
  } catch (error) {
    metrics.dbFailures.inc();
    log.warn({ err: error, kind: input.kind }, 'alert dedupe unavailable; sending without DB record');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { data, error } = await mailer.emails.send({
        from: env.ALERT_FROM_EMAIL,
        to: [env.OPERATOR_ALERT_EMAIL],
        subject: input.subject,
        text: `${input.body}\n\nkind=${input.kind} dedupeKey=${dedupeKey}`,
      });
      // The Resend SDK resolves with { error } instead of throwing on API
      // failures; without this check failed sends were recorded as sent.
      if (error) throw new Error(error.message);
      log.info({ kind: input.kind, providerMessageId: data?.id }, 'operator alert accepted by Resend');
      recentMemory.set(memoryKey, Date.now());
      if (recentMemory.size > 500) {
        for (const [key, at] of recentMemory) if (Date.now() - at > windowMs) recentMemory.delete(key);
      }
      if (rowId !== undefined) {
        await db.update(alertDeliveries).set({
          status: 'sent', attempts: attempt, sentAt: new Date(), error: null,
        }).where(eq(alertDeliveries.id, rowId)).catch((dbError) => {
          metrics.dbFailures.inc();
          log.warn({ err: dbError, kind: input.kind }, 'alert delivery status update failed');
        });
      }
      metrics.alertEmail.inc({ status: 'sent', kind: input.kind });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt, 1000, 10_000)));
    }
  }
  if (rowId !== undefined) {
    await db.update(alertDeliveries).set({
      status: 'failed', attempts: 3, error: String(lastError instanceof Error ? lastError.message : lastError),
    }).where(eq(alertDeliveries.id, rowId)).catch(() => undefined);
  }
  metrics.alertEmail.inc({ status: 'failed', kind: input.kind });
  log.error({ err: lastError, kind: input.kind }, 'operator alert delivery failed');
}

export async function alertApiError(route: string, errorId: string, message: string): Promise<void> {
  await sendOperatorAlert({
    kind: 'api_5xx', subject: `[handshake] API 5xx on ${route}`,
    body: `${message}\nerrorId=${errorId}`, dedupeKey: route,
  });
}

export async function alertWsFailure(chainId: number, message: string): Promise<void> {
  await sendOperatorAlert({
    kind: 'indexer_ws', subject: `[handshake] WebSocket failure on chain ${chainId}`,
    body: message, dedupeKey: String(chainId),
  });
}

export async function alertStaleEvents(maxAgeMs: number): Promise<void> {
  await sendOperatorAlert({
    kind: 'indexer_stale', subject: '[handshake] Indexer has no recent events',
    body: `Last accepted event age ${Math.round(maxAgeMs / 1000)}s exceeds ${env.STALE_EVENT_MS / 1000}s.`,
    dedupeKey: 'indexer-stale',
  });
}

export async function alertDbFailure(error: unknown): Promise<void> {
  await sendOperatorAlert({
    kind: 'db_failure', subject: '[handshake] Database failure',
    body: String(error instanceof Error ? error.message : error), dedupeKey: 'database',
  });
}

/** The keeper phase is deferred, so keeper_state rows are empty/stale. Read the
 *  RC debt/reserves from chain instead of reporting misleading zero gauges. */
const LASNA_CHAIN_ID = 5318007;
const lasnaClient = createPublicClient({ transport: http(httpUrlFor(LASNA_CHAIN_ID)) });

async function readRcTelemetry(): Promise<{ debt: bigint; reserves: bigint } | undefined> {
  try {
    const [debt, reserves] = await Promise.all([
      lasnaClient.readContract({
        address: SYSTEM_CONTRACT, abi: systemReadAbi, functionName: 'debt', args: [REACTIVE_CONTRACT],
      }),
      lasnaClient.readContract({
        address: SYSTEM_CONTRACT, abi: systemReadAbi, functionName: 'reserves', args: [REACTIVE_CONTRACT],
      }),
    ]);
    return { debt, reserves };
  } catch (error) {
    log.warn({ err: error }, 'RC telemetry read failed; keeping last gauge values');
    return undefined;
  }
}

/** Last successful on-chain RC reading, reused if a poll's RPC read is stale. */
let lastRcTelemetry: { debt: bigint; reserves: bigint; at: number } | undefined;

/**
 * Publish a read-only `keeper.status` frame from on-chain RC telemetry. The UI
 * marks a chain delayed when `debtWei > 0`; the Lasna chain id is always in an
 * order's delayed-chain set, so one RC frame surfaces "Delayed · network" for
 * every chain whose callback delivery the RC has paused. This is deliberately
 * independent of the signing keeper: no `keeper_state` row is written here and
 * no email is sent — it only appends to the outbox the SSE stream already uses.
 */
async function publishRcTelemetryStatus(
  telemetry: { debt: bigint; reserves: bigint },
  stale: boolean,
): Promise<void> {
  const [inserted] = await db.insert(outbox).values({
    type: 'keeper.status' as SseEventType,
    orderId: null,
    wallets: [],
    // This is an ephemeral status frame, not an undelivered business event:
    // mark it delivered at insert so the once-per-minute telemetry rows cannot
    // inflate the undelivered-outbox backlog. SSE replay uses outbox.id, not
    // delivered_at, so replay and live frames are unaffected.
    deliveredAt: new Date(),
    payload: {
      chainId: LASNA_CHAIN_ID,
      target: REACTIVE_CONTRACT,
      debtWei: telemetry.debt.toString(),
      reservesWei: telemetry.reserves.toString(),
      // Status only: `alert` flags a reading we could not refresh on this poll,
      // not an action taken or an email sent.
      action: stale ? 'alert' : 'none',
    },
  }).returning();
  if (!inserted) return;
  const event: PublishedEvent = {
    id: inserted.id, type: 'keeper.status', orderId: null, wallets: [],
    payload: inserted.payload, createdAt: inserted.createdAt,
  };
  bus.publish([event]);
}

/** Emits read-only keeper telemetry to the public stream and alerts on issues. */
export async function pollKeeperState(): Promise<void> {
  const rows = await db.select().from(keeperState).orderBy(desc(keeperState.lastCheckedAt)).limit(20);
  const now = Date.now();
  for (const row of rows) {
    const action = row.alertLevel === 'ok' ? 'none' : 'alert';
    const [inserted] = await db.insert(outbox).values({
      type: 'keeper.status' as SseEventType,
      orderId: null,
      wallets: [],
      payload: {
        chainId: row.chainId,
        target: row.target,
        debtWei: row.debtWei,
        reservesWei: row.reservesWei,
        action,
      },
    }).returning();
    if (inserted) {
      const event: PublishedEvent = {
        id: inserted.id, type: 'keeper.status', orderId: null, wallets: [],
        payload: inserted.payload, createdAt: inserted.createdAt,
      };
      bus.publish([event]);
    }
    const stale = now - new Date(row.lastCheckedAt).getTime() > 15 * 60_000;
    if (row.alertLevel !== 'ok' || stale) {
      await sendOperatorAlert({
        kind: 'keeper_issue',
        subject: `[handshake] Keeper issue: ${row.alertLevel} on chain ${row.chainId}`,
        body: `target=${row.target} debt=${row.debtWei} reserves=${row.reservesWei} stale=${stale}`,
        dedupeKey: `${row.target}:${row.chainId}:${row.alertLevel}`,
      });
    }
  }
  const onchain = await readRcTelemetry();
  if (onchain) {
    lastRcTelemetry = { ...onchain, at: Date.now() };
    metrics.rcDebtWei.set(Number(onchain.debt));
    metrics.rcReservesWei.set(Number(onchain.reserves));
  } else {
    metrics.rcDebtWei.set(Number(rows.find((row) => row.chainId === LASNA_CHAIN_ID)?.debtWei ?? 0));
    metrics.rcReservesWei.set(Number(rows.find((row) => row.chainId === LASNA_CHAIN_ID)?.reservesWei ?? 0));
  }
  for (const row of rows) {
    if (row.chainId !== LASNA_CHAIN_ID) metrics.escrowDebtWei.set({ chain: String(row.chainId) }, Number(row.debtWei));
  }
  // Publish even when the read is stale: keep the last known debt/reserves so a
  // transient RPC failure does not clear the user-facing delay signal. Skip
  // only when we have never had a successful reading (no fabricated zeros).
  const telemetry = onchain ?? lastRcTelemetry;
  if (telemetry) {
    const stale = !onchain && lastRcTelemetry !== undefined;
    if (stale && lastRcTelemetry) {
      log.debug({ ageMs: Date.now() - lastRcTelemetry.at }, 'publishing stale RC telemetry status');
    }
    await publishRcTelemetryStatus(telemetry, stale);
  }
}

let monitorTimer: ReturnType<typeof setInterval> | undefined;

/** Periodic operator checks: stale index and keeper state. Outbox depth is an
 *  append-only SSE cursor log with no delivery worker, so its size is not an
 *  alertable backlog signal; it remains observable via /metrics and /health. */
export function startAlertMonitor(): void {
  if (monitorTimer) return;
  const tick = async () => {
    try {
      const age = indexerStats.maxLastEventAgeMs();
      if (age > env.STALE_EVENT_MS) await alertStaleEvents(age);
      await pollKeeperState();
    } catch (error) {
      log.error({ err: error }, 'alert monitor tick failed');
    }
  };
  monitorTimer = setInterval(() => void tick(), 60_000);
  monitorTimer.unref();
  void (async () => {
    await hydrateAlertCooldowns().catch((error) => {
      metrics.dbFailures.inc();
      log.warn({ err: error }, 'alert cooldown hydration failed; continuing with DB dedupe');
    });
    await tick();
  })();
}

export function stopAlertMonitor(): void {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = undefined;
}
