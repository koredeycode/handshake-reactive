import { z } from 'zod';

/** Every named SSE `event:` value. Stable strings shared with the UI client. */
export const SSE_EVENT_TYPES = [
  'hello',
  'order.created',
  'order.state',
  'lock.payment',
  'lock.asset',
  'callback.requested',
  'terminal.release',
  'terminal.refund',
  'order.settled',
  'order.refunded',
  'wallet.balance',
  'notification',
  'keeper.status',
  'resync',
  'heartbeat',
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

export const sseEventTypeSchema = z.enum(SSE_EVENT_TYPES);

const meta = { eventId: z.number(), at: z.string() };
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimal = z.string().regex(/^\d+$/);

/**
 * Payload schemas for the `data:` line of each SSE frame. `eventId` is the
 * global outbox cursor and `at` the ISO creation time; `serializeSseRow` adds
 * both to the stored payload so replayed and live frames have identical shape.
 */
export const ssePayloadSchemas = {
  hello: z.object({
    ...meta,
    lastEventId: z.number(),
    serverTime: z.string(),
    statusCounts: z.object({
      open: z.number(),
      awaitingLock: z.number(),
      bothLocked: z.number(),
      settling: z.number(),
      settled: z.number(),
      refunded: z.number(),
      expired: z.number(),
    }),
  }),
  'order.created': z.object({
    ...meta,
    orderId: hex32,
    buyer: address.optional(),
    seller: address.optional(),
    paymentChainId: z.number().optional(),
    assetChainId: z.number().optional(),
    paymentToken: address.optional(),
    paymentAmount: decimal.optional(),
    assetToken: address.optional(),
    assetAmount: decimal.optional(),
    deadline: decimal.optional(),
    termsHash: hex32.optional(),
    venue: z.unknown().optional(),
    txHash: hex32.optional(),
    blockNumber: z.number().optional(),
  }),
  'order.state': z.object({
    ...meta,
    orderId: hex32,
    stage: z.string(),
    nonce: z.number(),
    txHash: hex32.optional(),
    blockNumber: z.number().optional(),
  }),
  'lock.payment': z.object({
    ...meta,
    orderId: hex32,
    depositor: address,
    counterparty: address,
    token: address,
    amount: decimal,
    termsHash: hex32,
    deadline: decimal,
    chainId: z.number(),
    txHash: hex32,
  }),
  'lock.asset': z.object({
    ...meta,
    orderId: hex32,
    seller: address,
    counterparty: address,
    token: address,
    amount: decimal,
    termsHash: hex32,
    deadline: decimal,
    chainId: z.number(),
    txHash: hex32,
  }),
  'callback.requested': z.object({
    ...meta,
    orderId: hex32,
    chainId: z.number(),
    recipient: address.optional(),
    gasLimit: z.number().optional(),
    functionName: z.string(),
    args: z.array(z.unknown()).optional(),
    txHash: hex32,
  }),
  'terminal.release': z.object({
    ...meta,
    orderId: hex32,
    leg: z.enum(['payment', 'asset']),
    seller: address.optional(),
    recipient: address.optional(),
    amount: decimal,
    nonce: z.number(),
    chainId: z.number(),
    txHash: hex32,
  }),
  'terminal.refund': z.object({
    ...meta,
    orderId: hex32,
    leg: z.enum(['payment', 'asset']),
    seller: address.optional(),
    depositor: address.optional(),
    amount: decimal,
    nonce: z.number(),
    chainId: z.number(),
    txHash: hex32,
    protocolViolation: z.boolean().optional(),
  }),
  'order.settled': z.object({
    ...meta,
    orderId: hex32,
    settledAt: z.string(),
    releaseTxHashes: z.object({ payment: z.string().optional(), asset: z.string().optional() }),
  }),
  'order.refunded': z.object({
    ...meta,
    orderId: hex32,
    reason: z.enum(['expired', 'invalid', 'cancelled', 'late', 'race_loser']),
    refundedAt: z.string(),
    refundTxHashes: z.array(hex32),
  }),
  'wallet.balance': z.object({
    ...meta,
    wallet: address,
    chainId: z.number(),
    token: address,
    newBalance: decimal,
    reason: z.enum(['lock', 'release', 'refund', 'transfer']),
    txHash: hex32,
  }),
  notification: z.object({
    ...meta,
    id: z.string(),
    wallet: address,
    orderId: hex32,
    kind: z.enum([
      'counterparty_locked',
      'settled',
      'refunded',
      'deadline_soon',
      'retry_failed',
    ]),
    title: z.string(),
    body: z.string(),
  }),
  'keeper.status': z.object({
    ...meta,
    chainId: z.number(),
    target: address,
    debtWei: decimal,
    reservesWei: decimal,
    action: z.enum(['none', 'topup', 'retry', 'alert']),
    txHash: hex32.optional(),
  }),
  resync: z.object({
    ...meta,
    reason: z.enum(['cursor_expired', 'buffer_overflow']),
    fromId: z.number(),
    toId: z.number(),
  }),
  heartbeat: z.object({ ...meta, at: z.string() }),
} satisfies Record<SseEventType, z.ZodTypeAny>;

export type OutboxPayload = Record<string, unknown>;

export type OutboxDraft = {
  type: SseEventType;
  payload: OutboxPayload;
  wallets: string[];
  orderId?: string | null;
};

export type StoredOrderEvent = {
  orderId?: string;
  eventName: string;
  [key: string]: unknown;
};

type OutboxRowLike = {
  id: number;
  type: string;
  payload: OutboxPayload;
  createdAt: Date;
};

/** Adds the global cursor + ISO timestamp to a stored payload. */
export function serializeSseRow(row: OutboxRowLike): { type: SseEventType; data: string } {
  const type = sseEventTypeSchema.safeParse(row.type);
  const data = JSON.stringify({
    ...row.payload,
    eventId: row.id,
    at: row.createdAt.toISOString(),
  });
  // Validation is advisory: malformed legacy rows are still delivered so a bad
  // row can never stall the whole stream. Log through the caller if needed.
  if (type.success) {
    ssePayloadSchemas[type.data].safeParse(JSON.parse(data));
  }
  return { type: type.success ? type.data : 'heartbeat', data };
}

/** Per-plan notification whitelist — all other derived events are UI state only. */
export const NOTIFICATION_KINDS = [
  'counterparty_locked',
  'settled',
  'refunded',
  'deadline_soon',
  'retry_failed',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
