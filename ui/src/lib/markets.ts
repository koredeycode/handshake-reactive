import { useCallback, useEffect, useMemo } from 'react'
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { CHAIN_IDS, type ChainKey } from './chains'
import { useConfig, withOverrides, type AppConfig } from './config'
import { reactiveAbi } from './contracts'
import { isEmptyOrder } from './format'
import type { Order } from './types'

/** Payment and asset roles are stable across markets; only their chains swap. */
export type LegKind = 'payment' | 'asset'

export interface MarketLeg {
  chainId: number
  chainKey: ChainKey
  escrow: string
  token: string
  tokenSymbol: string
  tokenDecimals: number
  callbackProxy: string
  scanFromBlock: number
}

export interface Market {
  id: string
  label: string
  direction: 'forward' | 'reverse'
  enabled: boolean
  reactive: { chainId: number; rc: string; deployBlock: number }
  payment: MarketLeg
  asset: MarketLeg
  scan: { lasnaFromBlock: number; lookbackBlocks: number }
  notes?: { latency?: string; proofSection?: string }
}

export interface MarketsRegistry {
  version: number
  defaultMarketId: string
  systemContract: string
  legacySystemContract: string
  markets: Market[]
}

export const FORWARD_MARKET_ID = 'forward-tusd-base-tasset-unichain'
export const OPEN_MARKET_ID = 'open-tusd-base-tasset-unichain'
export const REVERSE_MARKET_ID = 'reverse-tusd-unichain-tasset-base'
export const DEFAULT_MARKET_ID = FORWARD_MARKET_ID

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Chain keys always come from the leg's chain id, never from the direction label. */
const CHAIN_KEY_BY_ID = Object.fromEntries(
  Object.entries(CHAIN_IDS).map(([key, id]) => [id, key as ChainKey]),
) as Record<number, ChainKey>

export function chainKeyFromId(chainId: number, fallback: ChainKey): ChainKey {
  return CHAIN_KEY_BY_ID[chainId] ?? fallback
}

function isLeg(value: unknown): value is MarketLeg {
  if (!value || typeof value !== 'object') return false
  const leg = value as Partial<MarketLeg>
  return (
    typeof leg.chainId === 'number' &&
    typeof leg.escrow === 'string' &&
    typeof leg.token === 'string' &&
    typeof leg.tokenSymbol === 'string' &&
    typeof leg.tokenDecimals === 'number' &&
    typeof leg.callbackProxy === 'string' &&
    typeof leg.scanFromBlock === 'number'
  )
}

function isMarket(value: unknown): value is Market {
  if (!value || typeof value !== 'object') return false
  const market = value as Partial<Market>
  return (
    typeof market.id === 'string' &&
    typeof market.label === 'string' &&
    (market.direction === 'forward' || market.direction === 'reverse') &&
    typeof market.enabled === 'boolean' &&
    !!market.reactive &&
    typeof market.reactive.rc === 'string' &&
    typeof market.reactive.chainId === 'number' &&
    !!market.scan &&
    typeof market.scan.lasnaFromBlock === 'number' &&
    isLeg(market.payment) &&
    isLeg(market.asset)
  )
}

function parseRegistry(value: unknown): MarketsRegistry | null {
  if (!value || typeof value !== 'object') return null
  const json = value as Partial<MarketsRegistry>
  if (!Array.isArray(json.markets) || typeof json.defaultMarketId !== 'string') return null
  const markets = json.markets.filter(isMarket)
  if (!markets.length) return null
  return {
    version: typeof json.version === 'number' ? json.version : 1,
    defaultMarketId: json.defaultMarketId,
    systemContract: json.systemContract ?? '0x8888888888888888888888888888888888888888',
    legacySystemContract: json.legacySystemContract ?? ZERO_ADDRESS,
    markets,
  }
}

/** The one-market fallback keeps existing screens alive if markets.json is missing. */
function syntheticRegistry(config: AppConfig): MarketsRegistry {
  return {
    version: 1,
    defaultMarketId: DEFAULT_MARKET_ID,
    systemContract: config.reactive.systemContract,
    legacySystemContract: config.reactive.legacySystemContract,
    markets: [
      {
        id: DEFAULT_MARKET_ID,
        label: 'Pay on Base · receive on Unichain',
        direction: 'forward',
        enabled: true,
        reactive: {
          chainId: CHAIN_IDS.lasna,
          rc: config.reactive.reactiveContract,
          deployBlock: config.scan.lasnaFromBlock,
        },
        payment: {
          chainId: CHAIN_IDS.base,
          chainKey: 'base',
          escrow: config.base.paymentEscrow,
          token: config.base.paymentToken,
          tokenSymbol: 'tUSD',
          tokenDecimals: 6,
          callbackProxy: config.base.callbackProxy,
          scanFromBlock: config.scan.baseFromBlock,
        },
        asset: {
          chainId: CHAIN_IDS.unichain,
          chainKey: 'unichain',
          escrow: config.unichain.assetEscrow,
          token: config.unichain.assetToken,
          tokenSymbol: 'tASSET',
          tokenDecimals: 18,
          callbackProxy: config.unichain.callbackProxy,
          scanFromBlock: config.scan.unichainFromBlock,
        },
        scan: {
          lasnaFromBlock: config.scan.lasnaFromBlock,
          lookbackBlocks: config.scan.lookbackBlocks,
        },
      },
    ],
  }
}

async function loadRegistry(): Promise<MarketsRegistry | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}markets.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseRegistry(await res.json())
  } catch {
    return null
  }
}

function useMarketsRegistry(): { registry: MarketsRegistry; isFallback: boolean } {
  const config = useConfig()
  const fallback = useMemo(() => syntheticRegistry(config), [config])
  const { data } = useQuery({
    queryKey: ['markets-registry'],
    queryFn: loadRegistry,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return { registry: data ?? fallback, isFallback: !data }
}

/** All registry entries; only enabled ones participate in trading and inference. */
export function useMarkets(): Market[] {
  return useMarketsRegistry().registry.markets
}

/** Keys whose cached data belongs to one market and must never cross markets. */
const MARKET_SCOPED_KEYS = new Set([
  'order-ids',
  'order',
  'leg',
  'venues',
  'proof',
  'token-meta',
  'token-balance',
  'allowance',
  'health',
  'event-feed',
  'cron-status',
  'latency',
  // wagmi balance/read keys are scopeKey-namespaced with the market id.
  'balance',
  'readContract',
])

export function clearMarketQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => {
      const first = query.queryKey[0]
      return typeof first === 'string' && MARKET_SCOPED_KEYS.has(first)
    },
  })
  queryClient.invalidateQueries()
}

/** Find an enabled market by id. No UI exposes this list; links carry the id. */
export function findMarket(markets: readonly Market[], id?: string | null): Market | undefined {
  return markets.find((entry) => entry.enabled && entry.id === id)
}

/**
 * Internal market selection. The only input is the hidden `?market=` URL
 * parameter written by trade direction, board links and order inference; the
 * default is the forward market. There is no user-facing selector or stored
 * preference — a pasted/read-only link describes its own market.
 */
export function useMarket() {
  const { registry } = useMarketsRegistry()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const markets = useMemo(() => registry.markets.filter((market) => market.enabled), [registry])
  const market =
    findMarket(markets, params.get('market')) ??
    findMarket(markets, registry.defaultMarketId) ??
    markets[0] ??
    registry.markets[0]

  const chainKeyFor = useCallback(
    (role: LegKind): ChainKey => {
      const leg = market[role]
      return chainKeyFromId(leg.chainId, leg.chainKey)
    },
    [market],
  )

  const legConfig = useCallback((kind: LegKind): MarketLeg => market[kind], [market])

  /** `clear: false` keeps already-cached inference reads when resolving a link. */
  const setMarket = useCallback(
    (id: string, clear = true) => {
      const next = findMarket(markets, id)
      if (!next) return
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous)
          updated.set('market', next.id)
          return updated
        },
        { replace: true },
      )
      if (clear) clearMarketQueries(queryClient)
    },
    [markets, setParams, queryClient],
  )

  return {
    registry,
    markets,
    market,
    setMarket,
    chainKeyFor,
    legConfig,
    paymentChainKey: chainKeyFor('payment'),
    assetChainKey: chainKeyFor('asset'),
  }
}

interface LooseLasnaClient {
  readContract: (args: Record<string, unknown>) => Promise<unknown>
}

/**
 * Cheap market inference for a pasted order ID: one `getOrder` eth_call on
 * each enabled market's RC. Results are cached forever by order id + RC, so
 * repeated links make no extra calls.
 */
export function useInferMarket(orderId?: Hex | null, enabled = true) {
  const { markets } = useMarket()
  const client = (usePublicClient({ chainId: CHAIN_IDS.lasna }) ?? null) as unknown as LooseLasnaClient | null

  const results = useQueries({
    queries: markets.map((entry) => ({
      queryKey: ['market-inference', orderId, entry.reactive.rc],
      enabled: enabled && !!client && !!orderId,
      staleTime: Infinity,
      gcTime: Infinity,
      retryCount: 0,
      queryFn: async (): Promise<string | null> => {
        try {
          const result = (await client!.readContract({
            address: entry.reactive.rc,
            abi: reactiveAbi,
            functionName: 'getOrder',
            args: [orderId],
          })) as unknown as Order
          return isEmptyOrder(result) ? null : entry.id
        } catch {
          return null
        }
      },
    })),
  })

  const marketId = results.find((result) => result.data)?.data ?? null
  const isLoading = enabled && !!orderId && results.some((result) => result.isLoading)
  return { marketId, isLoading }
}

/**
 * Detail and track pages call this with the order id. An explicit hidden
 * `?market=` link wins; otherwise inference writes the resolved id back into
 * the (still invisible) URL so every downstream query shares one market.
 */
export function useEnsureMarket(orderId?: Hex | null) {
  const [params] = useSearchParams()
  const { markets, setMarket } = useMarket()
  const explicit = findMarket(markets, params.get('market'))?.id ?? null
  const inference = useInferMarket(orderId, !explicit)

  useEffect(() => {
    if (!explicit && inference.marketId && !params.get('market')) {
      setMarket(inference.marketId, false)
    }
  }, [explicit, inference.marketId, params, setMarket])

  return {
    ready: !!explicit || !!inference.marketId,
    isLoading: !explicit && inference.isLoading,
  }
}

/**
 * Adapter to the legacy AppConfig: its `base`/`unichain` slots hold *role* data
 * (payment/asset), so consumers must always pair it with `chainKeyFor(role)`
 * for clients, explorers, balances and faucet links.
 */
export function marketToAppConfig(registry: MarketsRegistry, market: Market): AppConfig {
  const config: AppConfig = {
    reactive: {
      reactiveContract: market.reactive.rc,
      systemContract: registry.systemContract,
      legacySystemContract: registry.legacySystemContract,
    },
    base: {
      paymentEscrow: market.payment.escrow,
      paymentToken: market.payment.token,
      callbackProxy: market.payment.callbackProxy,
    },
    unichain: {
      assetEscrow: market.asset.escrow,
      assetToken: market.asset.token,
      callbackProxy: market.asset.callbackProxy,
    },
    scan: {
      lasnaFromBlock: market.scan.lasnaFromBlock,
      baseFromBlock: market.payment.scanFromBlock,
      unichainFromBlock: market.asset.scanFromBlock,
      lookbackBlocks: market.scan.lookbackBlocks,
    },
  }
  // Build-time overrides remain valid for the default/forward deployment only.
  return market.id === registry.defaultMarketId ? withOverrides(config) : config
}

export function useMarketConfig(): AppConfig {
  const { registry, market } = useMarket()
  return useMemo(() => marketToAppConfig(registry, market), [registry, market])
}
