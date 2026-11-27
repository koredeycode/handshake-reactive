import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { env } from '../config.js';
import { bus, type PublishedEvent } from '../lib/bus.js';
import type { OutboxDraft, OutboxPayload, SseEventType, StoredOrderEvent } from '../lib/events.js';
import { log } from '../lib/log.js';
import { metrics } from '../lib/metrics.js';
import { db } from '../db/client.js';
import {
  indexerState,
  orderEvents,
  orderLegs,
  orders,
  outbox,
  venues,
  type OrderRow,
} from '../db/schema.js';
import type { DecodedEvent } from './decode.js';
import { emptyOrderState, foldEvent, stateFromRow, type FoldOrderState } from './fold.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toPayload(event: DecodedEvent): StoredOrderEvent {
  return { orderId: event.orderId, eventName: event.name, ...event.fields };
}

function orderValues(state: FoldOrderState) {
  return {
    termsHash: state.termsHash ?? null,
    buyer: state.buyer ?? null,
    seller: state.seller ?? null,
    paymentChainId: state.paymentChainId ?? null,
    assetChainId: state.assetChainId ?? null,
    paymentToken: state.paymentToken ?? null,
    paymentAmount: state.paymentAmount ?? null,
    assetToken: state.assetToken ?? null,
    assetAmount: state.assetAmount ?? null,
    deadline: state.deadline ?? null,
    status: state.status,
    settleRequested: state.settleRequested,
    refundRequested: state.refundRequested,
    paymentSeen: state.paymentSeen,
    assetSeen: state.assetSeen,
    paymentClosed: state.paymentClosed,
    assetClosed: state.assetClosed,
    winner: state.winner ?? null,
    assetLockCount: state.assetLockCount,
    nonce: state.nonce,
    paymentRequestNonce: state.paymentRequestNonce,
    assetRequestNonce: state.assetRequestNonce,
    protocolViolation: state.protocolViolation ?? null,
    updatedAt: new Date(),
  };
}

async function persistState(tx: Tx, state: FoldOrderState): Promise<void> {
  const values = orderValues(state);
  await tx.insert(orders).values({ orderId: state.orderId, ...values }).onConflictDoUpdate({
    target: orders.orderId,
    set: values,
  });
  for (const leg of state.legs) {
    const legValues = {
      orderId: state.orderId,
      role: leg.role,
      seller: leg.seller,
      token: leg.token,
      amount: leg.amount,
      counterparty: leg.counterparty,
      chainId: leg.chainId,
      txHash: leg.txHash,
      state: leg.state,
      nonce: leg.nonce,
    };
    await tx.insert(orderLegs).values(legValues).onConflictDoUpdate({
      target: [orderLegs.orderId, orderLegs.role, orderLegs.seller],
      set: {
        token: leg.token,
        amount: leg.amount,
        counterparty: leg.counterparty,
        chainId: leg.chainId,
        txHash: leg.txHash,
        state: leg.state,
        nonce: leg.nonce,
      },
    });
  }
}

async function insertOutbox(
  tx: Tx,
  drafts: OutboxDraft[],
  notifications: Array<{ wallet: string; orderId: string; kind: string; title: string; body: string }>,
  now: Date,
): Promise<PublishedEvent[]> {
  const rows: OutboxDraft[] = [...drafts];
  const dedupeWindow = new Date(now.getTime() - env.NOTIFICATION_COOLDOWN_MS);
  for (const notice of notifications) {
    const recent = await tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(and(
        eq(outbox.type, 'notification'),
        eq(outbox.orderId, notice.orderId),
        sql`${outbox.payload}->>'kind' = ${notice.kind}`,
        sql`${outbox.wallets} @> ARRAY[${notice.wallet}]::text[]`,
        gt(outbox.createdAt, dedupeWindow),
      ))
      .limit(1);
    if (recent.length > 0) continue;
    rows.push({
      type: 'notification',
      orderId: notice.orderId,
      wallets: [notice.wallet],
      payload: {
        id: `${notice.orderId}:${notice.kind}`,
        wallet: notice.wallet,
        orderId: notice.orderId,
        kind: notice.kind,
        title: notice.title,
        body: notice.body,
      },
    });
    metrics.notificationEvents.inc({ kind: notice.kind });
  }
  if (rows.length === 0) return [];
  const inserted = await tx.insert(outbox).values(rows.map((draft) => ({
    type: draft.type,
    orderId: draft.orderId ?? null,
    wallets: draft.wallets,
    payload: draft.payload as OutboxPayload,
    createdAt: now,
  }))).returning();
  return inserted.map((row) => ({
    id: row.id,
    type: row.type as SseEventType,
    orderId: row.orderId,
    wallets: row.wallets,
    payload: row.payload,
    createdAt: row.createdAt,
  }));
}

/**
 * Idempotent ingestion. The event insert, order fold, leg state and outbox rows
 * all commit in one transaction; the typed bus publish happens after commit.
 */
export async function ingestLog(event: DecodedEvent, blockTimestamp?: Date): Promise<PublishedEvent[]> {
  const now = blockTimestamp ?? new Date();
  let published: PublishedEvent[] = [];
  try {
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(orderEvents).values({
        chainId: event.chainId,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockHash: event.blockHash,
        address: event.address,
        eventName: event.name,
        payload: toPayload(event),
        removed: event.removed,
      }).onConflictDoNothing({ target: [orderEvents.chainId, orderEvents.txHash, orderEvents.logIndex] }).returning({ id: orderEvents.id });

      if (inserted.length === 0) return; // at-least-once delivery: already folded

      if (event.name === 'venueRegistered' || event.name === 'venueUnregistered') {
        const chainId = Number(event.fields.venueChainId ?? event.chainId);
        const paymentEscrow = String(event.fields.paymentEscrow ?? '');
        const assetEscrow = String(event.fields.assetEscrow ?? '');
        if (event.name === 'venueRegistered') {
          await tx.insert(venues).values({ chainId, paymentEscrow, assetEscrow, activeFrom: now })
            .onConflictDoNothing({ target: [venues.chainId, venues.paymentEscrow, venues.assetEscrow] });
        } else {
          await tx.update(venues).set({ activeTo: now })
            .where(and(eq(venues.chainId, chainId), eq(venues.paymentEscrow, paymentEscrow), eq(venues.assetEscrow, assetEscrow)));
        }
        return;
      }

      await tx.insert(indexerState).values({
        chainId: event.chainId, lastBlock: event.blockNumber, lastBlockHash: event.blockHash,
        lastEventAt: now, status: 'live', updatedAt: now,
      }).onConflictDoUpdate({
        target: indexerState.chainId,
        set: {
          lastBlock: sql`GREATEST(${indexerState.lastBlock}, ${event.blockNumber})`,
          lastBlockHash: event.blockHash,
          lastEventAt: now,
          status: 'live',
          updatedAt: now,
        },
      });

      metrics.indexerEvents.inc({ chain: String(event.chainId), event: event.name });

      if (!event.orderId || event.name === 'cron10') return;
      const orderId = event.orderId;
      const [row] = await tx.select().from(orders).where(eq(orders.orderId, orderId)).limit(1);
      const legs = await tx.select().from(orderLegs).where(eq(orderLegs.orderId, orderId));
      const state = row ? stateFromRow(row, legs) : emptyOrderState(orderId);
      const folded = foldEvent(state, event, now);
      if (!folded.changed) return;
      if (folded.violation) {
        log.warn({ orderId, violation: folded.violation }, 'protocol violation: refund after settleRequested');
      }
      await persistState(tx, folded.state);
      published = await insertOutbox(tx, folded.drafts, folded.notifications, now);
    });
  } catch (error) {
    metrics.dbFailures.inc();
    log.error({ err: error, chainId: event.chainId, event: event.name, txHash: event.txHash }, 'ingest failed');
    throw error;
  }
  bus.publish(published);
  if (published.length > 0) refreshOutboxDepth().catch(() => undefined);
  return published;
}

/**
 * ERC-20 Transfer hint for wallet balance refetch. Emitted only for curated
 * token contracts (they are the only token addresses in the log filter).
 */
export async function emitTransferBalances(event: DecodedEvent): Promise<PublishedEvent[]> {
  if (event.name !== 'transfer') return [];
  const from = typeof event.fields.from === 'string' ? event.fields.from.toLowerCase() : undefined;
  const to = typeof event.fields.to === 'string' ? event.fields.to.toLowerCase() : undefined;
  const token = event.address.toLowerCase();
  const wallets = [...new Set([from, to].filter((value): value is string => Boolean(value)))];
  if (wallets.length === 0) return [];
  const drafts = wallets.map((wallet) => ({
    type: 'wallet.balance' as const,
    orderId: undefined,
    wallets: [wallet],
    payload: {
      wallet, chainId: event.chainId, token, newBalance: '0',
      reason: 'transfer', txHash: event.txHash, refetch: true,
    },
  }));
  const events = await db.transaction(async (tx) => insertOutbox(tx, drafts, [], new Date()));
  bus.publish(events);
  return events;
}

/** Marks a log removed and rebuilds the affected orders from surviving logs. */
export async function handleReorg(event: DecodedEvent): Promise<PublishedEvent[]> {
  const now = new Date();
  let published: PublishedEvent[] = [];
  await db.transaction(async (tx) => {
    await tx.update(orderEvents).set({ removed: true })
      .where(and(
        eq(orderEvents.chainId, event.chainId),
        eq(orderEvents.txHash, event.txHash),
        eq(orderEvents.logIndex, event.logIndex),
      ));
    const affected = await tx
      .select({ orderId: sql<string>`${orderEvents.payload}->>'orderId'` })
      .from(orderEvents)
      .where(and(
        eq(orderEvents.chainId, event.chainId),
        eq(orderEvents.blockNumber, event.blockNumber),
        eq(orderEvents.removed, false),
      ));
    const ids = new Set<string>(affected.map((row) => row.orderId).filter(Boolean));
    if (event.orderId) ids.add(event.orderId);
    if (ids.size === 0) return;

    for (const orderId of ids) {
      const history = await tx.select().from(orderEvents)
        .where(and(
          eq(orderEvents.removed, false),
          sql`${orderEvents.payload}->>'orderId' = ${orderId}`,
        ))
        .orderBy(asc(orderEvents.blockNumber), asc(orderEvents.txHash), asc(orderEvents.logIndex));
      let state = emptyOrderState(orderId);
      for (const row of history) {
        // Re-fold through the same pure reducer; decode lazily to avoid a second RPC.
        const rebuilt: DecodedEvent = {
          name: row.eventName,
          chainId: row.chainId,
          txHash: row.txHash,
          logIndex: row.logIndex,
          blockNumber: row.blockNumber,
          blockHash: row.blockHash,
          address: row.address,
          removed: false,
          orderId,
          fields: (row.payload ?? {}) as Record<string, unknown>,
        };
        state = foldEvent(state, rebuilt, now).state;
      }
      await tx.delete(orderLegs).where(eq(orderLegs.orderId, orderId));
      await persistState(tx, state);
    }

    published = await insertOutbox(tx, [{
      type: 'resync',
      orderId: null,
      wallets: [],
      payload: { reason: 'cursor_expired', fromId: 0, toId: 0, reorg: true },
    }], [], now);
    if (published[0]) {
      // A resync frame points clients at the full REST refetch; the cursor range
      // is the last committed outbox id and the new resync row itself.
      await tx.update(outbox).set({
        payload: {
          reason: 'cursor_expired',
          fromId: Math.max(0, published[0].id - 1),
          toId: published[0].id,
          reorg: true,
        },
      }).where(eq(outbox.id, published[0].id));
      published[0].payload = {
        reason: 'cursor_expired', fromId: Math.max(0, published[0].id - 1),
        toId: published[0].id, reorg: true,
      };
    }
  });
  bus.publish(published);
  log.warn({ txHash: event.txHash, chainId: event.chainId }, 'reorg applied and clients asked to resync');
  return published;
}

export async function updateIndexerStatus(
  chainId: number,
  status: 'connecting' | 'live' | 'reconnecting' | 'error',
  blockNumber?: number,
  blockHash?: string,
): Promise<void> {
  await db.insert(indexerState).values({ chainId, lastBlock: blockNumber ?? 0, lastBlockHash: blockHash ?? null, status })
    .onConflictDoUpdate({
      target: indexerState.chainId,
      set: {
        status,
        ...(blockNumber !== undefined ? { lastBlock: sql`GREATEST(${indexerState.lastBlock}, ${blockNumber})` } : {}),
        ...(blockHash ? { lastBlockHash: blockHash } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function refreshOutboxDepth(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(outbox).where(sql`${outbox.deliveredAt} is null`);
  const depth = row?.count ?? 0;
  metrics.outboxDepth.set(depth);
  return depth;
}

export async function outboxDepth(): Promise<number> {
  return refreshOutboxDepth();
}

export async function getOrderRow(orderId: string): Promise<OrderRow | undefined> {
  const [row] = await db.select().from(orders).where(eq(orders.orderId, orderId)).limit(1);
  return row;
}
