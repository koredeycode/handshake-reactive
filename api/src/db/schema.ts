import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { OutboxPayload, StoredOrderEvent } from '../lib/events.js';

/** uint256 values are stored as base-10 strings (78 digits) to avoid JS precision loss. */
const u256 = (name: string) => numeric(name, { precision: 78, scale: 0 });
const hash = (name: string) => varchar(name, { length: 66 });
const address = (name: string) => varchar(name, { length: 42 });

export const chains = pgTable('chains', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  rpcUrl: text('rpc_url').notNull(),
  wsUrl: text('ws_url').notNull(),
  explorer: text('explorer'),
  callbackProxy: address('callback_proxy'),
  logChunkSize: integer('log_chunk_size').notNull().default(500),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const venues = pgTable(
  'venues',
  {
    id: serial('id').primaryKey(),
    chainId: integer('chain_id').notNull().references(() => chains.id),
    paymentEscrow: address('payment_escrow').notNull(),
    assetEscrow: address('asset_escrow').notNull(),
    activeFrom: timestamp('active_from', { withTimezone: true }).notNull().defaultNow(),
    activeTo: timestamp('active_to', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('venues_chain_escrows_idx').on(table.chainId, table.paymentEscrow, table.assetEscrow),
  ],
);

export const orders = pgTable(
  'orders',
  {
    orderId: hash('order_id').primaryKey(),
    termsHash: hash('terms_hash'),
    buyer: address('buyer'),
    seller: address('seller'),
    paymentChainId: integer('payment_chain_id'),
    assetChainId: integer('asset_chain_id'),
    paymentToken: address('payment_token'),
    paymentAmount: u256('payment_amount'),
    assetToken: address('asset_token'),
    assetAmount: u256('asset_amount'),
    deadline: u256('deadline'),
    status: text('status').notNull().default('open'),
    settleRequested: boolean('settle_requested').notNull().default(false),
    refundRequested: boolean('refund_requested').notNull().default(false),
    paymentSeen: boolean('payment_seen').notNull().default(false),
    assetSeen: boolean('asset_seen').notNull().default(false),
    paymentClosed: boolean('payment_closed').notNull().default(false),
    assetClosed: boolean('asset_closed').notNull().default(false),
    winner: address('winner'),
    assetLockCount: integer('asset_lock_count').notNull().default(0),
    nonce: bigint('nonce', { mode: 'number' }).notNull().default(0),
    paymentRequestNonce: bigint('payment_request_nonce', { mode: 'number' }).notNull().default(0),
    assetRequestNonce: bigint('asset_request_nonce', { mode: 'number' }).notNull().default(0),
    protocolViolation: text('protocol_violation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // settleRequested is terminal: a refunded order can never have requested settlement.
    check('orders_settle_refund_check', sql`NOT (${table.settleRequested} AND ${table.status} = 'refunded')`),
    index('orders_status_idx').on(table.status),
    index('orders_buyer_idx').on(table.buyer),
    index('orders_seller_idx').on(table.seller),
    index('orders_deadline_idx').on(table.deadline),
  ],
);

export const orderLegs = pgTable(
  'order_legs',
  {
    id: serial('id').primaryKey(),
    orderId: hash('order_id').notNull().references(() => orders.orderId, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'payment' | 'asset'
    seller: address('seller').notNull(), // zero address for the single payment leg
    token: address('token').notNull(),
    amount: u256('amount').notNull(),
    counterparty: address('counterparty'),
    chainId: integer('chain_id').notNull(),
    txHash: hash('tx_hash').notNull(),
    state: text('state').notNull().default('locked'), // locked | released | refunded
    nonce: bigint('nonce', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('order_legs_order_role_seller_idx').on(table.orderId, table.role, table.seller)],
);

export const orderEvents = pgTable(
  'order_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    chainId: integer('chain_id').notNull(),
    txHash: hash('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockHash: hash('block_hash').notNull(),
    address: address('address').notNull(),
    eventName: text('event_name').notNull(),
    payload: jsonb('payload').$type<StoredOrderEvent>().notNull(),
    removed: boolean('removed').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('order_events_chain_tx_log_idx').on(table.chainId, table.txHash, table.logIndex),
    index('order_events_order_idx').on(sql`(${table.payload}->>'orderId')`),
    index('order_events_block_idx').on(table.chainId, table.blockNumber),
  ],
);

/** Global, monotonic SSE cursor. Rows are retained for 7 days. */
export const outbox = pgTable(
  'outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: text('type').notNull(),
    orderId: hash('order_id'),
    wallets: text('wallets').array().notNull().default(sql`'{}'::text[]`),
    payload: jsonb('payload').$type<OutboxPayload>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_created_at_idx').on(table.createdAt),
    index('outbox_order_id_idx').on(table.orderId),
  ],
);

export const tokens = pgTable(
  'tokens',
  {
    id: serial('id').primaryKey(),
    chainId: integer('chain_id').notNull(),
    address: address('address').notNull(),
    symbol: text('symbol'),
    decimals: integer('decimals'),
    verified: boolean('verified').notNull().default(false),
    source: text('source').notNull().default('custom'), // curated | custom
    metadataHash: hash('metadata_hash'),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tokens_chain_address_idx').on(table.chainId, table.address)],
);

export const walletCache = pgTable(
  'wallet_cache',
  {
    wallet: address('wallet').notNull(),
    chainId: integer('chain_id').notNull(),
    token: address('token').notNull(), // 'native' sentinel for the gas token
    balance: u256('balance').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.wallet, table.chainId, table.token] })],
);

/** Operator alert deliveries only — no user email addresses are stored here. */
export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('pending'), // pending | sent | failed
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('alert_deliveries_recent_idx').on(table.kind, table.dedupeKey, table.createdAt)],
);

export const indexerState = pgTable('indexer_state', {
  chainId: integer('chain_id').primaryKey().references(() => chains.id),
  lastBlock: bigint('last_block', { mode: 'number' }).notNull().default(0),
  lastBlockHash: hash('last_block_hash'),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  status: text('status').notNull().default('connecting'), // connecting | live | reconnecting | error
  lagSeconds: integer('lag_seconds').notNull().default(0),
  reconnectCount: integer('reconnect_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const keeperState = pgTable(
  'keeper_state',
  {
    id: serial('id').primaryKey(),
    target: address('target').notNull(),
    chainId: integer('chain_id').notNull(),
    debtWei: u256('debt_wei').notNull().default(sql`'0'`),
    reservesWei: u256('reserves_wei').notNull().default(sql`'0'`),
    alertLevel: text('alert_level').notNull().default('ok'),
    lastTopUpTx: hash('last_top_up_tx'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('keeper_state_target_chain_idx').on(table.target, table.chainId)],
);

export const keeperActions = pgTable(
  'keeper_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    chainId: integer('chain_id').notNull(),
    action: text('action').notNull(), // topup | retry | alert
    amount: u256('amount'),
    txHash: hash('tx_hash'),
    reason: text('reason'),
    outcome: text('outcome').notNull(),
  },
  (table) => [index('keeper_actions_at_idx').on(table.at)],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderEventRow = typeof orderEvents.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
