import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  type Abi,
  type AbiEvent,
  type Hex,
} from 'viem'
import { chainKeyFromId, type ChainKey, type TradingChainKey } from './chains'
import { configuredAddress, type AppConfig } from './config'
import {
  assetLockedEvent,
  assetReleasedEvent,
  assetRefundedEvent,
  callbackConfigTuple,
  callbackPayloadAbi,
  callbackRequestEvent,
  cron100Event,
  paymentLockedEvent,
  paymentReleasedEvent,
  paymentRefundedEvent,
} from './contracts'
import { truncate } from './format'
import type { Order, ProofData, ProofEvent, ProofEventKind } from './types'

export interface ChainLog {
  topics: readonly Hex[]
  data: Hex
  blockNumber: bigint | null
  logIndex: number | null
  transactionHash: Hex | null
}

export interface LogClient {
  getLogs: (args: Record<string, unknown>) => Promise<readonly ChainLog[]>
  getBlock: (args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }>
  getBlockNumber: () => Promise<bigint>
}

export function logClient(client: unknown): LogClient | null {
  return (client ?? null) as LogClient | null
}

interface FetchLogsArgs {
  address?: string | null
  event?: AbiEvent
  args?: Record<string, unknown>
  fromBlock: bigint
  toBlock: bigint
  chunkSize?: bigint
  maxChunks?: number
  /** Return true once the caller has everything it needs; stops the walk early. */
  shouldStop?: (batch: readonly ChainLog[]) => boolean
}

/* -------------------------------------------------------------------------
 * Adaptive eth_getLogs chunking
 * -------------------------------------------------------------------------
 * Public providers disagree on the maximum eth_getLogs range: Base Sepolia's
 * official endpoint currently rejects >200 blocks with -32614, Unichain
 * rejects >1000 with -32602, and publicnode accepts 1000. A fixed chunk size
 * either fails or wastes calls. We remember a per-client ceiling: start at
 * 200 (accepted everywhere), grow slowly on success, halve and retry the
 * SAME window on a range error. No range is ever silently dropped.
 */
const SAFE_CHUNK = 200n
const MAX_CHUNK = 1_000n
// Grow quickly once a provider has proven a range works: publicnode accepts
// 1000 blocks, so a narrow window needs only a handful of calls there.
const GROW_AFTER = 3

interface ChunkState {
  chunk: bigint
  ceiling: bigint
  successes: number
  warned: boolean
}

const chunkStates = new WeakMap<object, ChunkState>()

function chunkState(client: object): ChunkState {
  let state = chunkStates.get(client)
  if (!state) {
    state = { chunk: SAFE_CHUNK, ceiling: MAX_CHUNK, successes: 0, warned: false }
    chunkStates.set(client, state)
  }
  return state
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const e = error as { message?: string; details?: string; shortMessage?: string; cause?: unknown }
  return `${e.message ?? ''} ${e.details ?? ''} ${e.shortMessage ?? ''} ${errorText(e.cause)}`
}

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  if (typeof code === 'number') return code
  const cause = (error as { cause?: unknown }).cause
  return cause === error ? undefined : errorCode(cause)
}

function isRangeLimitError(error: unknown): boolean {
  const code = errorCode(error)
  return (
    code === -32614 ||
    (code === -32602 && /range|block/i.test(errorText(error))) ||
    /limited to a \d+ range|block range greater|range too large|max.*range/i.test(errorText(error))
  )
}

function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status
  return (
    errorCode(error) === -32005 ||
    status === 429 ||
    /rate limit|too many requests/i.test(errorText(error))
  )
}

function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 1_000)))
}

export async function fetchLogs(client: LogClient, params: FetchLogsArgs): Promise<ChainLog[]> {
  const state = chunkState(client as object)
  let chunk = state.chunk > 0n ? state.chunk : SAFE_CHUNK
  const out: ChainLog[] = []
  let end = params.toBlock
  let chunks = 0
  let retries = 0
  const maxRetries = (params.maxChunks ?? 64) * 2 + 6

  while (end >= params.fromBlock && chunks < (params.maxChunks ?? 64)) {
    const start = end - chunk + 1n > params.fromBlock ? end - chunk + 1n : params.fromBlock
    try {
      const logs = await client.getLogs({
        address: params.address,
        event: params.event,
        args: params.args,
        fromBlock: start,
        toBlock: end,
      })
      out.push(...logs)
      chunks += 1
      state.successes += 1
      if (state.successes >= GROW_AFTER && chunk < state.ceiling && chunk < MAX_CHUNK) {
        const next = chunk * 2n < state.ceiling ? chunk * 2n : state.ceiling
        chunk = next < MAX_CHUNK ? next : MAX_CHUNK
        state.successes = 0
      }
      state.chunk = chunk
      if (params.shouldStop?.(logs)) break
      if (start <= params.fromBlock) break
      end = start - 1n
    } catch (error) {
      retries += 1
      if (isRangeLimitError(error)) {
        const halved = chunk / 2n > 0n ? chunk / 2n : 1n
        state.ceiling = halved
        chunk = halved
        state.chunk = chunk
        state.successes = 0
        if (!state.warned) {
          state.warned = true
          console.warn(
            `[handshake:rpc] eth_getLogs range capped at ${chunk} blocks for this RPC client; ` +
              'adjusting automatically. Set VITE_*_RPC to a provider with a wider range.',
          )
        }
        // Retry the SAME window with the smaller range; never skip it.
        continue
      }
      if (isRateLimitError(error)) {
        // One logical call already tried every fallback endpoint once
        // (retryCount: 0). Back off briefly and retry the same window.
        await backoff(retries)
        if (retries <= maxRetries) continue
      }
      if (retries > maxRetries) throw error
      await backoff(retries)
    }
  }
  return out
}

export function createTimestampResolver(clients: Partial<Record<ChainKey, LogClient | null>>) {
  const cache = new Map<string, number | null>()
  return async (chain: ChainKey, blockNumber: bigint | null): Promise<number | null> => {
    if (!blockNumber) return null
    const key = `${chain}:${blockNumber}`
    if (cache.has(key)) return cache.get(key) ?? null
    const client = clients[chain]
    let timestamp: number | null = null
    if (client) {
      try {
        const block = await client.getBlock({ blockNumber })
        timestamp = Number(block.timestamp)
      } catch {
        timestamp = null
      }
    }
    cache.set(key, timestamp)
    return timestamp
  }
}

type EventSpec = { kind: ProofEventKind; abi: AbiEvent }

const PAYMENT_EVENTS: EventSpec[] = [
  { kind: 'paymentLocked', abi: paymentLockedEvent },
  { kind: 'paymentReleased', abi: paymentReleasedEvent },
  { kind: 'paymentRefunded', abi: paymentRefundedEvent },
]
const ASSET_EVENTS: EventSpec[] = [
  { kind: 'assetLocked', abi: assetLockedEvent },
  { kind: 'assetReleased', abi: assetReleasedEvent },
  { kind: 'assetRefunded', abi: assetRefundedEvent },
]

function eventField(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value
  return String(value)
}

function decodeKind(log: ChainLog, spec: EventSpec): ProofEventKind | null {
  try {
    const decoded = decodeEventLog({
      abi: [spec.abi] as unknown as Abi,
      data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]],
      strict: false,
    })
    return decoded.eventName === spec.abi.name ? spec.kind : null
  } catch {
    return null
  }
}

function allFound(required: ReadonlySet<ProofEventKind>, found: ReadonlySet<ProofEventKind>): boolean {
  return required.size > 0 && [...required].every((kind) => found.has(kind))
}

/** Only as many chunks as the (now narrow) window can need, plus headroom. */
function chunksFor(range: BlockRange): number {
  const blocks = range.toBlock - range.fromBlock
  return Math.min(80, Math.max(2, Math.ceil(Number(blocks < 0n ? 0n : blocks) / Number(SAFE_CHUNK)) + 4))
}

async function decodeChainEvents(
  client: LogClient,
  chain: ChainKey,
  address: string,
  specs: EventSpec[],
  range: { fromBlock: bigint; toBlock: bigint },
  args: Record<string, unknown> | undefined,
  resolveTimestamp: (chain: ChainKey, block: bigint | null) => Promise<number | null>,
  found: Set<ProofEventKind>,
  required: ReadonlySet<ProofEventKind>,
): Promise<ProofEvent[]> {
  const events: ProofEvent[] = []
  await Promise.all(
    specs.map(async (spec) => {
      const logs = await fetchLogs(client, {
        address,
        event: spec.abi,
        args,
        ...range,
        maxChunks: chunksFor(range),
        // Decode the freshly fetched chunk once more here so the walk can stop
        // as soon as this order's required event kinds have been observed.
        shouldStop: (batch) => {
          for (const log of batch) {
            const kind = decodeKind(log, spec)
            if (kind) found.add(kind)
          }
          return allFound(required, found)
        },
      })
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: [spec.abi] as unknown as Abi,
            data: log.data,
            topics: [...log.topics] as [Hex, ...Hex[]],
            strict: false,
          })
          if (decoded.eventName !== spec.abi.name) continue
          const decodedArgs = (decoded.args ?? {}) as Record<string, unknown>
          const fields: Record<string, string> = {}
          for (const key of Object.keys(decodedArgs)) {
            const value = eventField(decodedArgs, key)
            if (value !== undefined && !/^\d+$/.test(key)) fields[key] = value
          }
          const nonceRaw = eventField(decodedArgs, 'nonce')
          events.push({
            id: `${chain}:${log.transactionHash}:${log.logIndex}:${spec.kind}`,
            kind: spec.kind,
            chain,
            txHash: log.transactionHash ?? '0x',
            blockNumber: log.blockNumber ?? 0n,
            logIndex: log.logIndex ?? 0,
            timestamp: await resolveTimestamp(chain, log.blockNumber),
            fields,
            nonce: nonceRaw ? BigInt(nonceRaw) : undefined,
          })
        } catch {
          // Unknown/unparseable log: skip rather than invent fields.
        }
      }
    }),
  )
  return events
}

function sortEvents(events: ProofEvent[]): ProofEvent[] {
  return [...events].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
    return a.logIndex - b.logIndex
  })
}

/** Role-keyed clients: which chain a role lives on comes from the order's venue. */
export interface ProofClients {
  lasna: LogClient | null
  payment: LogClient | null
  asset: LogClient | null
}

export interface ProofChainKeys {
  payment: TradingChainKey
  asset: TradingChainKey
}

/** One leg's log scan target, derived from a venue registry entry. */
export interface ProofScanTarget {
  chainKey: TradingChainKey
  escrow: string | null
  fromBlock: number
}

export interface ProofVenue {
  payment: ProofScanTarget
  asset: ProofScanTarget
}

export function proofVenue(venue: {
  paymentChainId: bigint
  paymentEscrow: string
  assetChainId: bigint
  assetEscrow: string
}, config: AppConfig): ProofVenue {
  const paymentKey = (chainKeyFromId(venue.paymentChainId) ?? 'base') as TradingChainKey
  const assetKey = (chainKeyFromId(venue.assetChainId) ?? 'unichain') as TradingChainKey
  return {
    payment: {
      chainKey: paymentKey,
      escrow: configuredAddress(venue.paymentEscrow),
      fromBlock: config.chains[paymentKey]?.scanFromBlock ?? 0,
    },
    asset: {
      chainKey: assetKey,
      escrow: configuredAddress(venue.assetEscrow),
      fromBlock: config.chains[assetKey]?.scanFromBlock ?? 0,
    },
  }
}

interface BlockRange {
  fromBlock: bigint
  toBlock: bigint
}

/** Fixed, bounded window around the RC deadline (documented tradeoff in RPC-AUDIT.md). */
// Base Sepolia produces blocks every ~0.2s, so 2,000 blocks was only ~7 min
// and missed locks placed early in a 30-minute order. 6,000 blocks is ~20 min
// there (and hours on slower chains) while still being a bounded scan.
const DEADLINE_LOOKBACK = 6_000n
const DEADLINE_FORWARD = 2_000n

function globalRange(fromBlock: number, latest: bigint, lookbackBlocks: number): BlockRange {
  const configured = BigInt(fromBlock || 0)
  const fallback = latest > BigInt(lookbackBlocks) ? latest - BigInt(lookbackBlocks) : 0n
  return { fromBlock: configured > 0n ? configured : fallback, toBlock: latest }
}

/**
 * The RC stores `deadline` (unix seconds) but no creation block. Rather than
 * scanning from the deployment-wide `scan.*FromBlock`, estimate the deadline's
 * block from two real block timestamps (the configured anchor and the tip)
 * and look a bounded number of blocks around it (6,000 before, 2,000 after).
 * Base Sepolia has ~0.2s blocks, so the lookback is ~20 min there and longer
 * on slower chains; that covers early locks in a normal settlement window.
 * Orders locked even earlier fall back to the configured global window.
 */
async function orderRange(
  config: AppConfig,
  client: LogClient | null,
  configuredFrom: number,
  latest: bigint,
  deadline: bigint | undefined | null,
): Promise<BlockRange> {
  const fallback = globalRange(configuredFrom, latest, config.scan.lookbackBlocks)
  if (!client || !deadline || deadline <= 0n || latest <= 0n) return fallback
  try {
    const configured = BigInt(configuredFrom || 0)
    const anchorBlock = configured > 0n && configured <= latest
      ? configured
      : latest > 50_000n
        ? latest - 50_000n
        : 0n
    if (anchorBlock >= latest) return fallback
    const [anchor, tip] = await Promise.all([
      client.getBlock({ blockNumber: anchorBlock }),
      client.getBlock({ blockNumber: latest }),
    ])
    const span = latest - anchorBlock
    const seconds = tip.timestamp - anchor.timestamp
    if (span <= 0n || seconds <= 0n) return fallback
    const secondsPerBlock = Number(seconds) / Number(span)
    if (!Number.isFinite(secondsPerBlock) || secondsPerBlock <= 0) return fallback
    const deadlineBlock =
      anchorBlock + BigInt(Math.round(Number(deadline - anchor.timestamp) / secondsPerBlock))
    let from = deadlineBlock > DEADLINE_LOOKBACK ? deadlineBlock - DEADLINE_LOOKBACK : 0n
    const to = deadlineBlock + DEADLINE_FORWARD < latest ? deadlineBlock + DEADLINE_FORWARD : latest
    if (configured > 0n && from < configured) from = configured
    if (to < from) return fallback
    return { fromBlock: from, toBlock: to }
  } catch {
    return fallback
  }
}

/** Subsequent polls only revisit a small overlap after the previous scan tip. */
function cursorRange(range: BlockRange, previousTo: bigint | undefined | null, latest: bigint): BlockRange {
  if (!previousTo || previousTo <= 0n || previousTo > latest) return range
  const overlap = previousTo > 200n ? previousTo - 200n : 0n
  return {
    fromBlock: overlap > range.fromBlock ? overlap : range.fromBlock,
    toBlock: range.toBlock,
  }
}

function requiredKinds(order?: Order | null): Set<ProofEventKind> {
  const required = new Set<ProofEventKind>()
  if (!order) return required
  if (order.paymentSeen) required.add('paymentLocked')
  if (order.assetSeen) required.add('assetLocked')
  if (order.settleRequested || order.paymentClosed || order.assetClosed || order.refundRequested) {
    required.add('reactive')
  }
  if (order.paymentClosed) required.add(order.refundRequested ? 'paymentRefunded' : 'paymentReleased')
  if (order.assetClosed) required.add(order.refundRequested ? 'assetRefunded' : 'assetReleased')
  return required
}

function decodeCallbackParts(log: ChainLog): {
  configBytes: Hex
  chainId: bigint
  recipient: string
  gasLimit: bigint
  payload: Hex
  functionName: string
  orderId: string
  nonce: string
} | null {
  try {
    const decoded = decodeEventLog({
      abi: [callbackRequestEvent] as unknown as Abi,
      data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]],
      strict: false,
    })
    const configBytes = (decoded.args as { configuration?: Hex }).configuration
    if (!configBytes) return null
    // PR #12 fix: decode as one tuple, never four flat parameters.
    const [cfg] = decodeAbiParameters(callbackConfigTuple, configBytes)
    const { chainId, recipient, gasLimit, payload } = cfg
    let call: { functionName?: string; args?: readonly unknown[] } = {}
    try {
      call = decodeFunctionData({ abi: callbackPayloadAbi, data: payload })
    } catch {
      return null
    }
    const orderId = (call.args?.[1] as Hex | undefined)?.toLowerCase()
    if (!orderId) return null
    // PR #12 fix: release/seller-release callbacks have 5/6 args; the nonce
    // is always last, not a fixed position.
    const nonce = call.args?.[call.args.length - 1]?.toString() ?? ''
    return {
      configBytes,
      chainId,
      recipient,
      gasLimit,
      payload,
      functionName: call.functionName ?? 'unknown',
      orderId,
      nonce,
    }
  } catch {
    // Skip logs that do not match the documented CallbackRequest shape.
    return null
  }
}

/** Resolve every observed tx hash for an order from logs on all three chains. */
export async function resolveProof(
  orderId: Hex,
  config: AppConfig,
  clients: ProofClients,
  order?: Order | null,
  previous?: ProofData | null,
  venue?: ProofVenue,
): Promise<ProofData> {
  const chainKeys: ProofChainKeys = {
    payment: venue?.payment.chainKey ?? 'base',
    asset: venue?.asset.chainKey ?? 'unichain',
  }
  // Timestamp lookups are keyed by the real chain key of each venue.
  const resolveTimestamp = createTimestampResolver({
    [chainKeys.payment]: clients.payment,
    [chainKeys.asset]: clients.asset,
    lasna: clients.lasna,
  })
  const [lasnaLatest, paymentLatest, assetLatest] = await Promise.all([
    clients.lasna?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.payment?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.asset?.getBlockNumber().catch(() => 0n) ?? 0n,
  ])
  const deadline = order?.deadline
  const [lasnaBase, paymentBase, assetBase] = await Promise.all([
    orderRange(config, clients.lasna, config.scan.lasnaFromBlock, lasnaLatest, deadline),
    orderRange(config, clients.payment, venue?.payment.fromBlock ?? 0, paymentLatest, deadline),
    orderRange(config, clients.asset, venue?.asset.fromBlock ?? 0, assetLatest, deadline),
  ])
  const lasnaRange = cursorRange(lasnaBase, previous?.scan.lasnaTo, lasnaLatest)
  const paymentRange = cursorRange(paymentBase, previous?.scan.paymentTo, paymentLatest)
  const assetRange = cursorRange(assetBase, previous?.scan.assetTo, assetLatest)

  const paymentEscrow = venue?.payment.escrow ?? null
  const assetEscrow = venue?.asset.escrow ?? null
  const system = configuredAddress(config.reactive.systemContract)
  const found = new Set<ProofEventKind>()
  const required = requiredKinds(order)
  // A final RC state rules out the opposite terminal event, so do not spend a
  // log scan on a branch that cannot exist. Pending orders keep all three.
  const finished = !!order && (order.paymentClosed && order.assetClosed || order.refundRequested)
  const paymentSpecs = finished
    ? PAYMENT_EVENTS.filter((spec) => spec.kind !== (order?.refundRequested ? 'paymentReleased' : 'paymentRefunded'))
    : PAYMENT_EVENTS
  const assetSpecs = finished
    ? ASSET_EVENTS.filter((spec) => spec.kind !== (order?.refundRequested ? 'assetReleased' : 'assetRefunded'))
    : ASSET_EVENTS

  const tasks: Promise<ProofEvent[]>[] = []
  if (clients.payment && paymentEscrow) {
    tasks.push(
      decodeChainEvents(
        clients.payment, chainKeys.payment, paymentEscrow, paymentSpecs, paymentRange, { orderId },
        resolveTimestamp, found, required,
      ),
    )
  }
  if (clients.asset && assetEscrow) {
    tasks.push(
      decodeChainEvents(
        clients.asset, chainKeys.asset, assetEscrow, assetSpecs, assetRange, { orderId },
        resolveTimestamp, found, required,
      ),
    )
  }
  if (clients.lasna && system) {
    tasks.push(
      (async () => {
        const logs = await fetchLogs(clients.lasna!, {
          address: system,
          event: callbackRequestEvent,
          ...lasnaRange,
          maxChunks: chunksFor(lasnaRange),
          shouldStop: (batch) => {
            for (const log of batch) {
              const parts = decodeCallbackParts(log)
              if (parts && parts.orderId === orderId.toLowerCase()) found.add('reactive')
            }
            return allFound(required, found)
          },
        })
        const out: ProofEvent[] = []
        for (const log of logs) {
          const parts = decodeCallbackParts(log)
          if (!parts || parts.orderId !== orderId.toLowerCase()) continue
          out.push({
            id: `lasna:${log.transactionHash}:${log.logIndex}:callbackRequest`,
            kind: 'reactive',
            chain: 'lasna',
            txHash: log.transactionHash ?? '0x',
            blockNumber: log.blockNumber ?? 0n,
            logIndex: log.logIndex ?? 0,
            timestamp: await resolveTimestamp('lasna', log.blockNumber),
            fields: {
              callback: parts.functionName,
              destinationChainId: parts.chainId.toString(),
              recipient: parts.recipient,
              gasLimit: parts.gasLimit.toString(),
              orderId: parts.orderId,
              nonce: parts.nonce,
            },
            nonce: BigInt(parts.nonce || 0),
          })
        }
        return out
      })(),
    )
  }

  const batches = await Promise.all(tasks)
  const events = sortEvents(batches.flat())
  const pick = (kind: ProofEventKind) => events.find((e) => e.kind === kind)
  const dedupe = (list: ProofEvent[]) =>
    Array.from(new Map(list.map((e) => [`${e.chain}:${e.txHash}`, e])).values())

  return {
    orderId,
    events: dedupe(events),
    paymentLocked: pick('paymentLocked'),
    assetLocked: pick('assetLocked'),
    reactive: pick('reactive'),
    paymentReleased: pick('paymentReleased'),
    assetReleased: pick('assetReleased'),
    paymentRefunded: pick('paymentRefunded'),
    assetRefunded: pick('assetRefunded'),
    scan: {
      lasnaFrom: lasnaRange.fromBlock,
      paymentFrom: paymentRange.fromBlock,
      assetFrom: assetRange.fromBlock,
      lasnaTo: lasnaRange.toBlock,
      paymentTo: paymentRange.toBlock,
      assetTo: assetRange.toBlock,
      to: lasnaRange.toBlock > paymentRange.toBlock
        ? (lasnaRange.toBlock > assetRange.toBlock ? lasnaRange.toBlock : assetRange.toBlock)
        : (paymentRange.toBlock > assetRange.toBlock ? paymentRange.toBlock : assetRange.toBlock),
    },
  }
}

export interface FeedEvent extends ProofEvent {
  label: string
  summary: string
}

/** Unfiltered multi-chain feed for the Event log screen (last ~2k blocks). */
export async function fetchEventFeed(
  config: AppConfig,
  clients: ProofClients,
  chainKeys: ProofChainKeys = { payment: 'base', asset: 'unichain' },
  venue?: ProofVenue,
): Promise<FeedEvent[]> {
  const resolveTimestamp = createTimestampResolver({
    [chainKeys.payment]: clients.payment,
    [chainKeys.asset]: clients.asset,
    lasna: clients.lasna,
  })
  const [paymentLatest, assetLatest, lasnaLatest] = await Promise.all([
    clients.payment?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.asset?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.lasna?.getBlockNumber().catch(() => 0n) ?? 0n,
  ])
  const window = 2_000n
  const range = (latest: bigint) => ({
    fromBlock: latest > window ? latest - window : 0n,
    toBlock: latest,
  })
  const paymentEscrow = venue?.payment.escrow ?? null
  const assetEscrow = venue?.asset.escrow ?? null
  const system = configuredAddress(config.reactive.systemContract)
  const legacy = configuredAddress(config.reactive.legacySystemContract)
  const noFound = new Set<ProofEventKind>()
  const noneRequired = new Set<ProofEventKind>()

  const tasks: Promise<ProofEvent[]>[] = []
  if (clients.payment && paymentEscrow) {
    tasks.push(decodeChainEvents(clients.payment, chainKeys.payment, paymentEscrow, PAYMENT_EVENTS, range(paymentLatest), undefined, resolveTimestamp, noFound, noneRequired))
  }
  if (clients.asset && assetEscrow) {
    tasks.push(decodeChainEvents(clients.asset, chainKeys.asset, assetEscrow, ASSET_EVENTS, range(assetLatest), undefined, resolveTimestamp, noFound, noneRequired))
  }
  if (clients.lasna && system) {
    tasks.push(
      (async () => {
        const logs = await fetchLogs(clients.lasna!, { address: system, event: callbackRequestEvent, ...range(lasnaLatest) })
        const out: ProofEvent[] = []
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({ abi: [callbackRequestEvent] as unknown as Abi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] })
            const args = decoded.args as unknown as { configuration: Hex }
            const [cfg] = decodeAbiParameters(callbackConfigTuple, args.configuration)
            out.push({
              id: `lasna:${log.transactionHash}:${log.logIndex}:callbackRequest`,
              kind: 'callbackRequest',
              chain: 'lasna',
              txHash: log.transactionHash ?? '0x',
              blockNumber: log.blockNumber ?? 0n,
              logIndex: log.logIndex ?? 0,
              timestamp: await resolveTimestamp('lasna', log.blockNumber),
              fields: {
                destinationChainId: cfg.chainId.toString(),
                recipient: cfg.recipient,
              },
            })
          } catch {
            // ignore
          }
        }
        return out
      })(),
    )
  }
  if (clients.lasna && legacy) {
    tasks.push(
      decodeChainEvents(
        clients.lasna,
        'lasna',
        legacy,
        [{ kind: 'cron100', abi: cron100Event }],
        { fromBlock: lasnaLatest > 100n ? lasnaLatest - 100n : 0n, toBlock: lasnaLatest },
        undefined,
        resolveTimestamp,
        noFound,
        noneRequired,
      ),
    )
  }

  const batches = await Promise.all(tasks)
  const labels: Record<ProofEventKind, string> = {
    paymentLocked: 'PaymentLocked',
    assetLocked: 'AssetLocked',
    reactive: 'Reactive decision',
    callbackRequest: 'CallbackRequest',
    paymentReleased: 'PaymentReleased',
    assetReleased: 'AssetReleased',
    paymentRefunded: 'PaymentRefunded',
    assetRefunded: 'AssetRefunded',
    cron10: 'Cron10',
    cron100: 'Cron100',
  }
  return batches
    .flat()
    .map((e) => ({
      ...e,
      label: labels[e.kind],
      summary: Object.entries(e.fields)
        .filter(([key]) => key !== 'orderId')
        .slice(0, 3)
        .map(([key, value]) => `${key}: ${key.toLowerCase().includes('amount') || key === 'nonce' ? value : truncate(value, 8, 6)}`)
        .join(' · '),
    }))
    .sort((a, b) => {
      const at = a.timestamp ?? 0
      const bt = b.timestamp ?? 0
      if (at !== bt) return bt - at
      if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1
      return b.logIndex - a.logIndex
    })
    .slice(0, 250)
}
