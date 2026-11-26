import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  type Abi,
  type AbiEvent,
  type Hex,
} from 'viem'
import type { ChainKey } from './chains'
import { configuredAddress, type AppConfig } from './config'
import {
  assetLockedEvent,
  assetReleasedEvent,
  assetRefundedEvent,
  callbackConfigTuple,
  callbackPayloadAbi,
  callbackRequestEvent,
  cron10Event,
  paymentLockedEvent,
  paymentReleasedEvent,
  paymentRefundedEvent,
} from './contracts'
import { truncate } from './format'
import type { ProofData, ProofEvent, ProofEventKind } from './types'

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
}

/**
 * Walks blocks backwards in bounded chunks so public RPC range limits cannot
 * silently truncate an order's history. Recent events are found first.
 */
export async function fetchLogs(client: LogClient, params: FetchLogsArgs): Promise<ChainLog[]> {
  // Public Sepolia RPCs (Unichain, Base) reject eth_getLogs ranges above ~1000
  // blocks with HTTP 400. Smaller chunks make the walk reliable; 64 chunks
  // covers ~64k blocks, enough for the configured fromBlock values.
  const chunk = params.chunkSize ?? 1_000n
  const maxChunks = params.maxChunks ?? 64
  const out: ChainLog[] = []
  let end = params.toBlock
  let chunks = 0
  while (end >= params.fromBlock && chunks < maxChunks) {
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
    } catch {
      // A failed range must not become a fabricated result; try the next one.
    }
    chunks += 1
    if (start <= params.fromBlock) break
    end = start - 1n
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

async function decodeChainEvents(
  client: LogClient,
  chain: ChainKey,
  address: string,
  specs: EventSpec[],
  range: { fromBlock: bigint; toBlock: bigint },
  args: Record<string, unknown> | undefined,
  resolveTimestamp: (chain: ChainKey, block: bigint | null) => Promise<number | null>,
): Promise<ProofEvent[]> {
  const events: ProofEvent[] = []
  await Promise.all(
    specs.map(async (spec) => {
      const logs = await fetchLogs(client, {
        address,
        event: spec.abi,
        args,
        ...range,
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

export interface ProofClients {
  lasna: LogClient | null
  base: LogClient | null
  unichain: LogClient | null
}

function scanRange(config: AppConfig, fromBlock: number, latest: bigint): { fromBlock: bigint; toBlock: bigint } {
  const configured = BigInt(fromBlock)
  const fallback = latest > BigInt(config.scan.lookbackBlocks)
    ? latest - BigInt(config.scan.lookbackBlocks)
    : 0n
  return { fromBlock: configured > 0n ? configured : fallback, toBlock: latest }
}

/** Resolve every observed tx hash for an order from logs on all three chains. */
export async function resolveProof(
  orderId: Hex,
  config: AppConfig,
  clients: ProofClients,
): Promise<ProofData> {
  const resolveTimestamp = createTimestampResolver(clients)
  const [lasnaLatest, baseLatest, unichainLatest] = await Promise.all([
    clients.lasna?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.base?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.unichain?.getBlockNumber().catch(() => 0n) ?? 0n,
  ])
  const lasnaRange = scanRange(config, config.scan.lasnaFromBlock, lasnaLatest)
  const baseRange = scanRange(config, config.scan.baseFromBlock, baseLatest)
  const unichainRange = scanRange(config, config.scan.unichainFromBlock, unichainLatest)

  const paymentEscrow = configuredAddress(config.base.paymentEscrow)
  const assetEscrow = configuredAddress(config.unichain.assetEscrow)
  const system = configuredAddress(config.reactive.systemContract)

  const tasks: Promise<ProofEvent[]>[] = []
  if (clients.base && paymentEscrow) {
    tasks.push(
      decodeChainEvents(clients.base, 'base', paymentEscrow, PAYMENT_EVENTS, baseRange, { orderId }, resolveTimestamp),
    )
  }
  if (clients.unichain && assetEscrow) {
    tasks.push(
      decodeChainEvents(clients.unichain, 'unichain', assetEscrow, ASSET_EVENTS, unichainRange, { orderId }, resolveTimestamp),
    )
  }
  if (clients.lasna && system) {
    tasks.push(
      (async () => {
        const logs = await fetchLogs(clients.lasna!, {
          address: system,
          event: callbackRequestEvent,
          fromBlock: lasnaRange.fromBlock,
          toBlock: lasnaRange.toBlock,
        })
        const out: ProofEvent[] = []
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({
              abi: [callbackRequestEvent] as unknown as Abi,
              data: log.data,
              topics: [...log.topics] as [Hex, ...Hex[]],
              strict: false,
            })
            const configBytes = (decoded.args as { configuration?: Hex }).configuration
            if (!configBytes) continue
            const [cfg] = decodeAbiParameters(callbackConfigTuple, configBytes)
            const { chainId: destChain, recipient, gasLimit, payload } = cfg
            let call: { functionName?: string; args?: readonly unknown[] } = {}
            try {
              call = decodeFunctionData({ abi: callbackPayloadAbi, data: payload })
            } catch {
              continue
            }
            const callOrderId = (call.args?.[1] as Hex | undefined)?.toLowerCase()
            if (callOrderId !== orderId.toLowerCase()) continue
            out.push({
              id: `lasna:${log.transactionHash}:${log.logIndex}:callbackRequest`,
              kind: 'reactive',
              chain: 'lasna',
              txHash: log.transactionHash ?? '0x',
              blockNumber: log.blockNumber ?? 0n,
              logIndex: log.logIndex ?? 0,
              timestamp: await resolveTimestamp('lasna', log.blockNumber),
              fields: {
                callback: call.functionName ?? 'unknown',
                destinationChainId: destChain.toString(),
                recipient,
                gasLimit: gasLimit.toString(),
                orderId: callOrderId ?? '',
                nonce: call.args?.[call.args.length - 1]?.toString() ?? '',
              },
              nonce: BigInt((call.args?.[call.args.length - 1] as bigint) ?? 0n),
            })
          } catch {
            // Skip logs that do not match the documented CallbackRequest shape.
          }
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
      baseFrom: baseRange.fromBlock,
      unichainFrom: unichainRange.fromBlock,
      to: lasnaLatest > baseLatest ? (lasnaLatest > unichainLatest ? lasnaLatest : unichainLatest) : unichainLatest,
    },
  }
}

export interface FeedEvent extends ProofEvent {
  label: string
  summary: string
}

/** Unfiltered multi-chain feed for the Event log screen (last ~2k blocks). */
export async function fetchEventFeed(config: AppConfig, clients: ProofClients): Promise<FeedEvent[]> {
  const resolveTimestamp = createTimestampResolver(clients)
  const [baseLatest, unichainLatest, lasnaLatest] = await Promise.all([
    clients.base?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.unichain?.getBlockNumber().catch(() => 0n) ?? 0n,
    clients.lasna?.getBlockNumber().catch(() => 0n) ?? 0n,
  ])
  const window = 2_000n
  const range = (latest: bigint) => ({
    fromBlock: latest > window ? latest - window : 0n,
    toBlock: latest,
  })
  const paymentEscrow = configuredAddress(config.base.paymentEscrow)
  const assetEscrow = configuredAddress(config.unichain.assetEscrow)
  const system = configuredAddress(config.reactive.systemContract)
  const legacy = configuredAddress(config.reactive.legacySystemContract)

  const tasks: Promise<ProofEvent[]>[] = []
  if (clients.base && paymentEscrow) {
    tasks.push(decodeChainEvents(clients.base, 'base', paymentEscrow, PAYMENT_EVENTS, range(baseLatest), undefined, resolveTimestamp))
  }
  if (clients.unichain && assetEscrow) {
    tasks.push(decodeChainEvents(clients.unichain, 'unichain', assetEscrow, ASSET_EVENTS, range(unichainLatest), undefined, resolveTimestamp))
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
        [{ kind: 'cron10', abi: cron10Event }],
        { fromBlock: lasnaLatest > 100n ? lasnaLatest - 100n : 0n, toBlock: lasnaLatest },
        undefined,
        resolveTimestamp,
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
