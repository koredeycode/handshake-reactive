#!/usr/bin/env node
/**
 * One-off, idempotent restoration of historical *origin-chain audit rows* for
 * the orders that already exist in Supabase.
 *
 * The live indexer started ~8h after the proof loops and its initial HTTP gap
 * fill only covered Base 1,000 / Unichain 5,000 / Sepolia 2,500 blocks, so the
 * PaymentLocked/AssetLocked/PaymentReleased/AssetReleased/PaymentRefunded/
 * AssetRefunded logs for those orders never reached `order_events` and the UI
 * hop timeline shows empty tx hashes.
 *
 * This script ONLY inserts into `order_events`. It never folds order state,
 * never writes outbox rows, never publishes notifications and never touches a
 * contract. Dry-run is the default; --apply performs the inserts.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  decodeEventLog,
  http,
  toHex,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';
import {
  CHAIN_BY_ID,
  TOPICS,
  assetLockedEvent,
  assetRefundedEvent,
  assetReleasedEvent,
  paymentLockedEvent,
  paymentRefundedEvent,
  paymentReleasedEvent,
} from '../api/src/contracts.js';

// ---------------------------------------------------------------------------
// Constants taken verbatim from api/src/contracts.ts (no ABI/topic guessing).
// ---------------------------------------------------------------------------

type EventKind = 'lock' | 'release' | 'refund';
type EventDef = { key: string; topic0: Hex; abi: AbiEvent; kind: EventKind };

const ORIGIN_EVENTS: EventDef[] = [
  { key: 'paymentLocked', topic0: TOPICS.paymentLocked, abi: paymentLockedEvent as AbiEvent, kind: 'lock' },
  { key: 'assetLocked', topic0: TOPICS.assetLocked, abi: assetLockedEvent as AbiEvent, kind: 'lock' },
  { key: 'paymentReleased', topic0: TOPICS.paymentReleased, abi: paymentReleasedEvent as AbiEvent, kind: 'release' },
  { key: 'paymentRefunded', topic0: TOPICS.paymentRefunded, abi: paymentRefundedEvent as AbiEvent, kind: 'refund' },
  { key: 'assetReleased', topic0: TOPICS.assetReleased, abi: assetReleasedEvent as AbiEvent, kind: 'release' },
  { key: 'assetRefunded', topic0: TOPICS.assetRefunded, abi: assetRefundedEvent as AbiEvent, kind: 'refund' },
];

const TOPIC_TO_EVENT = new Map(ORIGIN_EVENTS.map((event) => [event.topic0.toLowerCase(), event]));
const ORIGIN_CHAIN_IDS = [84532, 1301, 11155111] as const;
const RPC_DEFAULTS: Record<number, string> = {
  84532: 'https://base-sepolia-rpc.publicnode.com',
  1301: 'https://unichain-sepolia-rpc.publicnode.com',
  11155111: 'https://sepolia.gateway.tenderly.co',
};
/** One hour before the earliest deadline on each chain. */
const DEADLINE_LOOKBACK_SECONDS = 3_600;
/** Per-chain safety net; a window larger than this aborts before any write. */
const DEFAULT_MAX_BLOCKS = 1_000_000;

type RpcClient = ReturnType<typeof createPublicClient>;

/**
 * Public defaults are the same ones api/src/config.ts uses. The official
 * endpoints are fallbacks because some publicnode endpoints prune old
 * eth_getLogs / header history, which is exactly what this backfill needs.
 */
function rpcUrls(chainId: number): string[] {
  switch (chainId) {
    case 84532:
      return [process.env.BASE_RPC || RPC_DEFAULTS[84532]!, 'https://sepolia.base.org'];
    case 1301:
      return [process.env.UNICHAIN_RPC || RPC_DEFAULTS[1301]!, 'https://sepolia.unichain.org'];
    case 11155111:
      return [process.env.SEPOLIA_RPC || RPC_DEFAULTS[11155111]!, 'https://ethereum-sepolia-rpc.publicnode.com'];
    default:
      throw new Error(`no RPC URLs for chain ${chainId}`);
  }
}

// ---------------------------------------------------------------------------
// Small structural types (postgres.js is owned by the api package).
// ---------------------------------------------------------------------------

type SqlClient = {
  <T extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray, ...values: unknown[]
  ): Promise<T[]>;
  unsafe<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string, params?: unknown[],
  ): Promise<T[]>;
  begin<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
};

type DbOrder = {
  order_id: string;
  payment_chain_id: number | null;
  asset_chain_id: number | null;
  deadline: string | null;
};

type ChainCfg = {
  chainId: number;
  name: string;
  /** eth_getLogs cap: Base 200, Unichain 1000, Sepolia 500 (from CHAIN_CONFIGS). */
  chunkSize: number;
  /** Escrow addresses only — token addresses/Cron topics are irrelevant here. */
  addresses: Address[];
  topic0s: Hex[];
  escrows: Map<string, 'payment' | 'asset'>;
};

type RawLog = {
  address: string;
  data: Hex;
  topics: readonly Hex[];
  blockNumber: string | number | bigint | null;
  blockHash: string | null;
  transactionHash: string | null;
  logIndex: string | number | null;
  removed?: boolean;
};

type Candidate = {
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  address: string;
  eventName: string;
  payload: Record<string, unknown>;
  removed: boolean;
  receivedAt: Date;
};

type SkippedChunk = { from: number; to: number; reason: string };

type ChainResult = {
  cfg: ChainCfg;
  start?: number;
  head?: number;
  minDeadline?: bigint;
  skippedReason?: string;
  error?: string;
  chunks: number;
  logsFound: number;
  candidates: Candidate[];
  decodeFailures: number;
  timestampFailures: number;
  skipped: SkippedChunk[];
};

type Options = {
  apply: boolean;
  help: boolean;
  orderId?: string;
  maxBlocks: number;
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): string {
  return [
    'Usage: npx tsx scripts/backfill-order-history.ts [options]',
    '',
    'One-off backfill of missing origin-chain event hashes for the 41 orders already in Supabase.',
    '',
    'Options:',
    '  --dry-run            default; scan and report, never write to the database',
    '  --apply              insert missing order_events rows (ON CONFLICT DO NOTHING)',
    '  --order <0x...>      restrict to one order id (still must exist in orders)',
    '  --max-blocks <n>     per-chain scan guard (default 1000000)',
    '  --help               print this message',
    '',
    'Env: DATABASE_URL (Supabase pooler URL), optional BASE_RPC / UNICHAIN_RPC / SEPOLIA_RPC.',
    'postgres.js is resolved from api/node_modules: run `npm ci --prefix api` first.',
  ].join('\n');
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, help: false, maxBlocks: DEFAULT_MAX_BLOCKS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--order' || arg.startsWith('--order=')) {
      const value = arg === '--order' ? argv[++i] : arg.slice('--order='.length);
      if (!value) throw new Error('--order requires a 0x order id');
      options.orderId = value;
    } else if (arg === '--max-blocks' || arg.startsWith('--max-blocks=')) {
      const value = arg === '--max-blocks' ? argv[++i] : arg.slice('--max-blocks='.length);
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('--max-blocks must be a positive integer');
      options.maxBlocks = parsed;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** viem errors embed the whole JSON-RPC request; keep reports readable. */
function shortError(error: unknown): string {
  const firstLine = errorMessage(error).split('\n')[0] ?? 'unknown error';
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
}

/** Errors that another provider can reasonably be expected to serve. */
function isFailoverError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('pruned history') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('fetch failed') ||
    message.includes('http request failed')
  );
}

function isRangeError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('range') ||
    message.includes('too many') ||
    message.includes('block not found') ||
    message.includes('query returned more') ||
    message.includes('response size')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded backoff for 429s/transport errors; range errors bail out immediately. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (attempt === attempts || isRangeError(error) || isFailoverError(error)) break;
      const delay = Math.round(Math.min(8_000, 400 * 2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4));
      console.warn(`    retry ${label}: ${shortError(error)} (attempt ${attempt}/${attempts}, wait ${delay}ms)`);
      await sleep(delay);
    }
  }
  throw last;
}

/** One client per configured URL, with failover for pruned history / 429s. */
class RpcPool {
  private readonly clients: RpcClient[];
  private active = 0;

  constructor(private readonly chainId: number) {
    this.clients = rpcUrls(chainId).map((url) =>
      createPublicClient({ transport: http(url, { timeout: 30_000, retryCount: 0 }) }),
    );
  }

  async call<T>(label: string, fn: (client: RpcClient) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let offset = 0; offset < this.clients.length; offset += 1) {
      const index = (this.active + offset) % this.clients.length;
      try {
        const value = await withRetry(`${label} [rpc ${index}]`, () => fn(this.clients[index]!));
        this.active = index;
        return value;
      } catch (error) {
        last = error;
        if (!isFailoverError(error)) break; // range errors are handled by splitting the chunk
        console.warn(`    ${shortError(error)}; trying next RPC for chain ${this.chainId}`);
      }
    }
    throw last;
  }
}

function connectDb(): SqlClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required. Export the Supabase pooler URL before running this script.');
  }
  // postgres.js is a dependency of the api package, not the root tooling package.
  const apiRequire = createRequire(fileURLToPath(new URL('../api/package.json', import.meta.url)));
  type PostgresFactory = (connectionString: string, options: Record<string, unknown>) => SqlClient;
  const asFactory = (module: unknown): PostgresFactory => {
    // CJS/ESM interop: postgres.js exposes the constructor on `.default` here.
    if (typeof module === 'function') return module as PostgresFactory;
    const defaultExport = (module as { default?: unknown })?.default;
    if (typeof defaultExport === 'function') return defaultExport as PostgresFactory;
    throw new Error('postgres.js module has no callable default export');
  };
  let factory: PostgresFactory;
  try {
    factory = asFactory(apiRequire('postgres'));
  } catch {
    try {
      factory = asFactory(createRequire(import.meta.url)('postgres'));
    } catch {
      throw new Error('postgres.js not found; run `npm ci --prefix api` (or install postgres.js at the repo root).');
    }
  }
  // prepare:false keeps Supabase transaction-mode poolers happy (same as the API).
  return factory(url, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 10,
    onnotice: () => undefined,
  });
}

function chainConfig(chainId: number): ChainCfg {
  const chain = CHAIN_BY_ID.get(chainId);
  if (!chain) throw new Error(`unknown origin chain ${chainId}`);
  const escrowAddresses = [chain.paymentEscrow, chain.assetEscrow]
    .filter((address): address is Address => Boolean(address))
    .map((address) => address.toLowerCase());
  const escrowSet = new Set(escrowAddresses);
  return {
    chainId,
    name: chain.name,
    chunkSize: chain.logChunkSize,
    // CHAIN_CONFIGS also carries token addresses + Transfer; strip them so the
    // filter is exactly [6 origin topic0s] x [the two escrows].
    addresses: chain.addresses.filter((address) => escrowSet.has(address.toLowerCase())),
    topic0s: chain.topic0s.filter((topic) => TOPIC_TO_EVENT.has(topic.toLowerCase())),
    escrows: chain.escrows,
  };
}

function decimal(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value : '0';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Mirrors `toPayload` in api/src/indexer/ingest.ts and `decodeRawLog` in
 * api/src/indexer/decode.ts, including the camelCase event names and the
 * decimal-string representation of uint values.
 */
function decodeCandidate(raw: RawLog, cfg: ChainCfg, allowedOrderIds: Set<string>): Candidate | null {
  const topic0 = asString(raw.topics[0])?.toLowerCase();
  const def = topic0 ? TOPIC_TO_EVENT.get(topic0) : undefined;
  if (!def) return null;
  let decoded: { args?: unknown };
  try {
    decoded = decodeEventLog({
      abi: [def.abi],
      data: raw.data,
      topics: raw.topics as [Hex, ...Hex[]],
      strict: false,
    });
  } catch {
    return null;
  }
  const args = (decoded.args ?? {}) as Record<string, unknown>;
  const orderId = asString(args.orderId);
  if (!orderId || !allowedOrderIds.has(orderId.toLowerCase())) return null;
  const role = cfg.escrows.get(asString(raw.address)?.toLowerCase() ?? '');

  let fields: Record<string, unknown>;
  switch (def.kind) {
    case 'lock':
      fields = {
        orderId,
        depositor: asString(args.depositor),
        counterparty: asString(args.counterparty),
        token: asString(args.token),
        amount: decimal(args.amount),
        termsHash: asString(args.termsHash),
        deadline: decimal(args.deadline),
        role,
      };
      break;
    case 'release':
      fields = {
        orderId,
        recipient: asString(args.recipient),
        amount: decimal(args.amount),
        nonce: Number(decimal(args.nonce)),
        role,
      };
      break;
    case 'refund':
      fields = {
        orderId,
        depositor: asString(args.depositor),
        amount: decimal(args.amount),
        nonce: Number(decimal(args.nonce)),
        role,
      };
      break;
  }

  return {
    chainId: cfg.chainId,
    txHash: asString(raw.transactionHash) ?? `0x${'0'.repeat(64)}`,
    logIndex: Number(raw.logIndex ?? 0),
    blockNumber: Number(raw.blockNumber ?? 0),
    blockHash: asString(raw.blockHash) ?? `0x${'0'.repeat(64)}`,
    address: asString(raw.address) ?? '',
    eventName: def.key,
    payload: { orderId, eventName: def.key, ...fields },
    removed: Boolean(raw.removed),
    receivedAt: new Date(0), // replaced with the block timestamp by scanChain
  };
}

async function rawBlockTimestamp(pool: RpcPool, blockNumber: number): Promise<number | null> {
  const block = await pool.call(`eth_getBlockByNumber(${blockNumber})`, (client) =>
    client.request({ method: 'eth_getBlockByNumber', params: [toHex(BigInt(blockNumber)), false] }),
  );
  const timestamp = (block as { timestamp?: Hex } | null)?.timestamp;
  return timestamp ? Number(timestamp) : null;
}

/**
 * Greatest block whose timestamp is <= target. Bracket by doubling backwards
 * from head, then binary search inside that bracket: probing the chain's
 * midpoint would hit headers public RPCs have already pruned.
 */
async function findStartBlock(
  pool: RpcPool,
  chainId: number,
  head: number,
  targetSeconds: number,
): Promise<number> {
  const timestampAt = async (block: number): Promise<number> => {
    const timestamp = await rawBlockTimestamp(pool, block);
    if (timestamp === null) throw new Error(`chain ${chainId} block ${block} has no timestamp`);
    return timestamp;
  };
  if (await timestampAt(head) <= targetSeconds) return head;

  let lower = 0;
  let upper = head;
  let step = 1;
  while (true) {
    const probe = Math.max(0, head - step);
    if (await timestampAt(probe) <= targetSeconds) {
      lower = probe;
      break;
    }
    upper = probe;
    if (probe === 0) return 0; // even genesis is newer than the target
    step *= 2;
  }
  while (lower < upper) {
    const mid = Math.ceil((lower + upper) / 2);
    if (await timestampAt(mid) <= targetSeconds) lower = mid;
    else upper = mid - 1;
  }
  return lower;
}

/** eth_getLogs with topic1 = array of DB order ids (OR), splitting on range errors. */
async function fetchRange(
  pool: RpcPool,
  cfg: ChainCfg,
  from: number,
  to: number,
  orderIds: Hex[],
  result: ChainResult,
): Promise<RawLog[]> {
  const collected: RawLog[] = [];
  let cursor = from;
  let size = to - from + 1;
  while (cursor <= to) {
    const end = Math.min(to, cursor + size - 1);
    try {
      const logs = await pool.call(`eth_getLogs ${cfg.chainId} ${cursor}..${end}`, (client) =>
        client.request({
          method: 'eth_getLogs',
          params: [{
            fromBlock: toHex(BigInt(cursor)),
            toBlock: toHex(BigInt(end)),
            address: cfg.addresses,
            // Within a topic position, an array is an OR. topic1 is orderId for
            // all six origin events, so this restricts logs to our known orders.
            topics: [cfg.topic0s, orderIds],
          }],
        }),
      );
      collected.push(...((logs ?? []) as unknown as RawLog[]));
      cursor = end + 1;
      size = Math.min(cfg.chunkSize, size * 2);
    } catch (error) {
      if (isRangeError(error) && end > cursor) {
        size = Math.max(1, Math.floor(size / 2));
        console.warn(`    range error on ${cursor}..${end}; retrying with ${size}-block chunks`);
        continue;
      }
      result.skipped.push({ from: cursor, to: end, reason: shortError(error) });
      console.warn(`    skipped ${cfg.chainId} ${cursor}..${end}: ${shortError(error)}`);
      cursor = end + 1;
      size = Math.min(cfg.chunkSize, size * 2);
    }
  }
  return collected;
}

async function scanChain(
  cfg: ChainCfg,
  orders: DbOrder[],
  orderIds: Hex[],
  allowedOrderIds: Set<string>,
  maxBlocks: number,
): Promise<ChainResult> {
  const result: ChainResult = {
    cfg, chunks: 0, logsFound: 0, candidates: [], decodeFailures: 0, timestampFailures: 0, skipped: [],
  };
  const chainOrders = orders.filter((order) =>
    order.payment_chain_id === cfg.chainId || order.asset_chain_id === cfg.chainId);
  if (chainOrders.length === 0) {
    result.skippedReason = 'no known orders reference this origin chain';
    return result;
  }
  const deadlines = chainOrders
    .map((order) => BigInt(order.deadline ?? '0'))
    .filter((deadline) => deadline > 0n);
  if (deadlines.length === 0) {
    result.skippedReason = 'no usable deadlines for orders on this chain';
    return result;
  }
  result.minDeadline = deadlines.reduce((min, deadline) => (deadline < min ? deadline : min));

  const pool = new RpcPool(cfg.chainId);
  const head = Number(await pool.call(`eth_blockNumber(${cfg.chainId})`, (client) =>
    client.request({ method: 'eth_blockNumber' }),
  ));
  result.head = head;
  const targetSeconds = Number(result.minDeadline > BigInt(DEADLINE_LOOKBACK_SECONDS)
    ? result.minDeadline - BigInt(DEADLINE_LOOKBACK_SECONDS)
    : 0n);
  const start = await findStartBlock(pool, cfg.chainId, head, targetSeconds);
  result.start = start;
  const span = head - start + 1;
  if (span > maxBlocks) {
    throw new Error(
      `chain ${cfg.chainId}: window ${start}..${head} is ${span} blocks, above --max-blocks ${maxBlocks}; raise the guard or narrow --order`,
    );
  }

  const blockTimestamps = new Map<number, Date>();
  for (let from = start; from <= head; from += cfg.chunkSize) {
    const to = Math.min(head, from + cfg.chunkSize - 1);
    const logs = await fetchRange(pool, cfg, from, to, orderIds, result);
    result.chunks += 1;
    result.logsFound += logs.length;
    for (const raw of logs) {
      const candidate = decodeCandidate(raw, cfg, allowedOrderIds);
      if (!candidate) {
        result.decodeFailures += 1;
        continue;
      }
      let receivedAt = blockTimestamps.get(candidate.blockNumber);
      if (!receivedAt) {
        let timestamp: number | null = null;
        try {
          timestamp = await rawBlockTimestamp(pool, candidate.blockNumber);
        } catch (error) {
          console.warn(`    skipped ${cfg.chainId} block ${candidate.blockNumber} timestamp: ${shortError(error)}`);
        }
        if (timestamp === null) {
          result.timestampFailures += 1;
          continue;
        }
        receivedAt = new Date(timestamp * 1_000);
        blockTimestamps.set(candidate.blockNumber, receivedAt);
      }
      candidate.receivedAt = receivedAt;
      result.candidates.push(candidate);
    }
  }
  return result;
}

function eventKey(row: Pick<Candidate, 'chainId' | 'txHash' | 'logIndex'>): string {
  return `${row.chainId}:${row.txHash}:${row.logIndex}`;
}

async function duplicateKeys(sql: SqlClient, candidates: Candidate[]): Promise<Set<string>> {
  const duplicates = new Set<string>();
  if (candidates.length === 0) return duplicates;
  const rows = await sql.unsafe<{ chain_id: number; tx_hash: string; log_index: number }>(
    `select chain_id, tx_hash, log_index from order_events
     where chain_id = any($1::int[]) and tx_hash = any($2::varchar[]) and log_index = any($3::int[])`,
    [
      candidates.map((row) => row.chainId),
      candidates.map((row) => row.txHash),
      candidates.map((row) => row.logIndex),
    ],
  );
  for (const row of rows) duplicates.add(eventKey({ chainId: row.chain_id, txHash: row.tx_hash, logIndex: row.log_index }));
  return duplicates;
}

async function insertRows(sql: SqlClient, rows: Candidate[]): Promise<number> {
  if (rows.length === 0) return 0;
  return sql.begin(async (tx) => {
    let inserted = 0;
    for (const row of rows) {
      // Uniqueness key is the unique index order_events_chain_tx_log_idx,
      // i.e. (chain_id, tx_hash, log_index) — the same target the indexer uses.
      const result = await tx.unsafe<{ id: number }>(
        `insert into order_events
           (chain_id, tx_hash, log_index, block_number, block_hash, address,
            event_name, payload, removed, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         on conflict (chain_id, tx_hash, log_index) do nothing
         returning id`,
        [
          row.chainId, row.txHash, row.logIndex, row.blockNumber, row.blockHash,
          row.address, row.eventName, row.payload, row.removed, row.receivedAt,
        ],
      );
      inserted += result.length;
    }
    return inserted;
  });
}

function printReport(results: ChainResult[], duplicates: Set<string>, applied: number | null): void {
  let totalFound = 0;
  let totalExisting = 0;
  let totalSkipped = 0;
  for (const result of results) {
    const { cfg } = result;
    console.log(`\n[${cfg.chainId} ${cfg.name}]`);
    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
      continue;
    }
    if (result.skippedReason) {
      console.log(`  skipped: ${result.skippedReason}`);
      continue;
    }
    const found = result.candidates.length;
    const existing = result.candidates.filter((row) => duplicates.has(eventKey(row))).length;
    totalFound += found;
    totalExisting += existing;
    totalSkipped += result.skipped.length;
    console.log(`  min deadline: ${result.minDeadline?.toString()} (${new Date(Number(result.minDeadline) * 1_000).toISOString()})`);
    console.log(`  target time:  ${new Date(Number(result.minDeadline! - BigInt(DEADLINE_LOOKBACK_SECONDS)) * 1_000).toISOString()} (-${DEADLINE_LOOKBACK_SECONDS}s)`);
    console.log(`  scan range:   ${result.start}..${result.head} (${result.head! - result.start! + 1} blocks), chunk cap ${cfg.chunkSize}`);
    console.log(`  chunks: ${result.chunks}, logs: ${result.logsFound}, decoded: ${found}, decode/order-id misses: ${result.decodeFailures}, timestamp misses: ${result.timestampFailures}`);
    console.log(`  skipped chunks: ${result.skipped.length}${result.skipped.length ? ` -> ${result.skipped.map((s) => `${s.from}..${s.to}`).join(', ')}` : ''}`);
    console.log(`  duplicate rows already present: ${existing}; new rows: ${found - existing}`);
    if (found > 0) {
      console.log('  sample tx hashes:');
      for (const row of result.candidates.slice(0, 5)) {
        console.log(`    ${row.txHash}  ${row.eventName}  block ${row.blockNumber}  ${row.receivedAt.toISOString()}`);
      }
    }
  }
  console.log('\n=== SUMMARY ===');
  console.log(`events found: ${totalFound}; already present: ${totalExisting}; new: ${totalFound - totalExisting}`);
  console.log(`skipped chunks: ${totalSkipped}`);
  if (applied === null) {
    console.log('DRY RUN: no rows written, no outbox/notification/fold side effects.');
  } else {
    console.log(`APPLIED: ${applied} row(s) inserted into order_events (ON CONFLICT DO NOTHING); no fold/outbox/notification side effects.`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const sql = connectDb();
  try {
    const orders = await sql<DbOrder>`select order_id, payment_chain_id, asset_chain_id, deadline from orders`;
    const selected = options.orderId
      ? orders.filter((order) => order.order_id.toLowerCase() === options.orderId!.toLowerCase())
      : orders;
    if (selected.length === 0) {
      throw new Error(options.orderId
        ? `--order ${options.orderId} matched no row in orders (table has ${orders.length} rows)`
        : 'orders table is empty; nothing to backfill');
    }
    const allowedOrderIds = new Set(selected.map((order) => order.order_id.toLowerCase()));
    // topic1 is a bytes32 orderId; pass every selected DB id (OR) on every chain.
    const orderIds = [...allowedOrderIds].map((id) => id as Hex);

    console.log(`mode: ${options.apply ? 'APPLY' : 'DRY RUN'} (default dry-run)`);
    console.log(`orders in DB: ${orders.length}; selected: ${selected.length}${options.orderId ? ` (--order ${options.orderId})` : ''}`);
    console.log(`max-blocks per chain: ${options.maxBlocks}`);

    const results: ChainResult[] = [];
    for (const chainId of ORIGIN_CHAIN_IDS) {
      const cfg = chainConfig(chainId);
      try {
        results.push(await scanChain(cfg, selected, orderIds, allowedOrderIds, options.maxBlocks));
      } catch (error) {
        results.push({
          cfg, chunks: 0, logsFound: 0, candidates: [], decodeFailures: 0,
          timestampFailures: 0, skipped: [], error: errorMessage(error),
        });
        process.exitCode = 1;
      }
    }

    const candidates = results.flatMap((result) => result.candidates);
    const duplicates = await duplicateKeys(sql, candidates);
    const missing = candidates.filter((row) => !duplicates.has(eventKey(row)));
    let applied: number | null = null;
    if (options.apply) applied = await insertRows(sql, missing);
    printReport(results, duplicates, applied);
    if (results.some((result) => result.error)) {
      console.error('\nOne or more chains failed; no incomplete data was applied silently. Review the report.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(`backfill failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
