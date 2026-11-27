import { useCallback, useMemo } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  CHAIN_IDS,
  CHAIN_LABELS,
  TRADING_CHAIN_KEYS,
  chainKeyFromId,
  type ChainKey,
  type TradingChainKey,
} from './chains'
import { configuredAddress, useConfig, type AppConfig } from './config'
import { pairId, pairLabel, parsePairId } from './venue'
import { useTradeTicket, type TicketKind } from './tradeTicket'
import { useVenues } from './venues'

/** A leg of the currently selected ordered chain pair (not a deployed market). */
export interface MarketLeg {
  chainId: number
  chainKey: TradingChainKey
  escrow: string | null
  token: string | null
  tokenSymbol: string
  tokenDecimals: number
  callbackProxy: string
  scanFromBlock: number
}

export interface Market {
  id: string
  label: string
  direction: 'forward' | 'reverse'
  payment: MarketLeg
  asset: MarketLeg
  scan: { lasnaFromBlock: number; lookbackBlocks: number }
  reactive: { chainId: number; rc: string; deployBlock: number }
}

export type LegKind = TicketKind

/** Keys whose cached data belongs to one venue and must never cross venues. */
const MARKET_SCOPED_KEYS = new Set([
  'order-ids',
  'order',
  'leg',
  'venue',
  'registered-chain-ids',
  'subscription-count',
  'proof',
  'token-meta',
  'token-balance',
  'wallet-token-balances',
  'custom-token',
  'allowance',
  'health',
  'event-feed',
  'cron-status',
  'latency',
  'market-inference',
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

function legFrom(
  chain: TradingChainKey,
  config: AppConfig,
  escrow: string | null,
  token: { address: string; symbol: string; decimals: number } | null,
): MarketLeg {
  const chainConfig = config.chains[chain]
  return {
    chainId: CHAIN_IDS[chain],
    chainKey: chain,
    escrow,
    token: token?.address ?? null,
    tokenSymbol: token?.symbol ?? '—',
    tokenDecimals: token?.decimals ?? 18,
    callbackProxy: chainConfig?.callbackProxy ?? '',
    scanFromBlock: chainConfig?.scanFromBlock ?? 0,
  }
}

/**
 * The trade ticket holds an ORDERED CHAIN PAIR plus one token per side. There
 * is no deployed-market list and no user-facing market selector: flipping the
 * arrow swaps the chains, and each side has its own chain/token picker.
 */
export function useMarket() {
  const config = useConfig()
  const venues = useVenues()
  const ticket = useTradeTicket()

  const market = useMemo<Market>(() => {
    const paymentChain = ticket.chainFor('payment')
    const assetChain = ticket.chainFor('asset')
    const paymentToken = ticket.tokenFor('payment')
    const assetToken = ticket.tokenFor('asset')
    const paymentVenue = venues.byChain(paymentChain)
    const assetVenue = venues.byChain(assetChain)
    const rc = configuredAddress(config.reactive.reactiveContract) ?? ''
    return {
      id: pairId(paymentChain, assetChain),
      label: pairLabel(paymentChain, assetChain),
      direction: paymentChain === 'unichain' && assetChain === 'base' ? 'reverse' : 'forward',
      payment: legFrom(paymentChain, config, paymentVenue?.paymentEscrow ?? null, paymentToken),
      asset: legFrom(assetChain, config, assetVenue?.assetEscrow ?? null, assetToken),
      scan: { lasnaFromBlock: config.scan.lasnaFromBlock, lookbackBlocks: config.scan.lookbackBlocks },
      reactive: { chainId: CHAIN_IDS.lasna, rc, deployBlock: config.scan.lasnaFromBlock },
    }
  }, [ticket, venues, config])

  const markets = useMemo<Market[]>(() => {
    const pairs: Market[] = []
    for (const payment of TRADING_CHAIN_KEYS) {
      for (const asset of TRADING_CHAIN_KEYS) {
        if (payment === asset) continue
        const paymentVenue = venues.byChain(payment)
        const assetVenue = venues.byChain(asset)
        if (!paymentVenue?.registered || !assetVenue?.registered) continue
        const rc = configuredAddress(config.reactive.reactiveContract) ?? ''
        pairs.push({
          id: pairId(payment, asset),
          label: pairLabel(payment, asset),
          direction: payment === 'unichain' && asset === 'base' ? 'reverse' : 'forward',
          payment: legFrom(payment, config, paymentVenue.paymentEscrow, null),
          asset: legFrom(asset, config, assetVenue.assetEscrow, null),
          scan: { lasnaFromBlock: config.scan.lasnaFromBlock, lookbackBlocks: config.scan.lookbackBlocks },
          reactive: { chainId: CHAIN_IDS.lasna, rc, deployBlock: config.scan.lasnaFromBlock },
        })
      }
    }
    return pairs
  }, [venues, config])

  const chainKeyFor = useCallback((role: LegKind): TradingChainKey => ticket.chainFor(role), [ticket])
  const legConfig = useCallback((kind: LegKind): MarketLeg => market[kind], [market])
  const setMarket = useCallback(
    (id: string) => {
      const parsed = parsePairId(id)
      if (!parsed) return
      if (parsed.payment !== ticket.chainFor('payment')) ticket.setChain('payment', parsed.payment)
      if (parsed.asset !== ticket.chainFor('asset')) ticket.setChain('asset', parsed.asset)
    },
    [ticket],
  )

  return {
    registry: { systemContract: config.reactive.systemContract, legacySystemContract: config.reactive.legacySystemContract },
    markets,
    market,
    setMarket,
    chainKeyFor,
    legConfig,
    paymentChainKey: chainKeyFor('payment'),
    assetChainKey: chainKeyFor('asset'),
    config,
  }
}

export function findMarket(markets: readonly Market[], id?: string | null): Market | undefined {
  return markets.find((entry) => entry.id === id)
}

/** Single RC: there is nothing to infer. Kept as no-op adapters for pages. */
export function useInferMarket(_orderId?: string | null, _enabled = true) {
  return { marketId: null as string | null, isLoading: false }
}

export function useEnsureMarket(_orderId?: string | null) {
  const config = useConfig()
  return { ready: !!configuredAddress(config.reactive.reactiveContract), isLoading: false }
}

export function useMarketConfig(): AppConfig {
  return useConfig()
}

/** Chain labels for a chain id from any venue (used by board rows and logs). */
export function chainLabelFromId(chainId: number | bigint): string {
  const key = chainKeyFromId(chainId)
  return key ? CHAIN_LABELS[key] : `Chain ${chainId}`
}

export function chainPillKey(chainId: number | bigint): ChainKey {
  return chainKeyFromId(chainId) ?? 'base'
}
