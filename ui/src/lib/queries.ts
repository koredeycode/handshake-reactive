import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { useOrders, type OrderRow, type OrdersResult } from './apiQueries'
import { erc20Abi } from './contracts'
import {
  CHAIN_IDS,
  CHAIN_LABELS,
  TRADING_CHAIN_KEYS,
  chainKeyFromId,
  type ChainKey,
  type TradingChainKey,
} from './chains'
import { DEFAULT_CONFIG, configuredAddress, type AppConfig } from './config'
import { deriveTokenDisplay, useTokenRegistry } from './tokenDisplay'
import { pairId, venueOfOrder } from './venue'
import type { Market } from './markets'
import type { Order } from './types'

/**
 * Data hooks now come from the public read API (see apiQueries.ts); this module
 * keeps the chain/venue presentation helpers and the public hook names intact.
 */
export {
  useOrders,
  useOrder,
  useOrderDetail,
  useOrderEvents,
  useLeg,
  useTokenMeta,
  useErc20Balance,
  useTokenBalance,
  useDiscoveredBalances,
  useApiBalances,
  useWalletTokens,
  useNativeBalances,
  useHealth,
  useTokenCatalog,
  type OrderRow,
  type OrdersResult,
  type HealthRow,
} from './apiQueries'
export type { TicketKind as LegKind } from './tradeTicket'

/** Build display data for a row entirely from the order's own venue tuple. */
export function marketFromOrder(order: Order): Market {
  const payment = venueOfOrder(order, 'payment')
  const asset = venueOfOrder(order, 'asset')
  const config: AppConfig = DEFAULT_CONFIG
  const registry = undefined
  const paymentDisplay = deriveTokenDisplay(payment.chainKey, payment.token, registry)
  const assetDisplay = deriveTokenDisplay(asset.chainKey, asset.token, registry)
  const proxyFor = (chain: TradingChainKey) => config.chains[chain]?.callbackProxy ?? ''
  const scanFor = (chain: TradingChainKey) => config.chains[chain]?.scanFromBlock ?? 0
  return {
    id: pairId(payment.chainKey, asset.chainKey),
    label: `${CHAIN_LABELS[payment.chainKey]} → ${CHAIN_LABELS[asset.chainKey]}`,
    direction: payment.chainKey === 'unichain' && asset.chainKey === 'base' ? 'reverse' : 'forward',
    payment: {
      chainId: payment.chainId,
      chainKey: payment.chainKey,
      escrow: payment.escrow,
      token: payment.token,
      tokenSymbol: paymentDisplay.symbol,
      tokenDecimals: paymentDisplay.decimals,
      callbackProxy: proxyFor(payment.chainKey),
      scanFromBlock: scanFor(payment.chainKey),
    },
    asset: {
      chainId: asset.chainId,
      chainKey: asset.chainKey,
      escrow: asset.escrow,
      token: asset.token,
      tokenSymbol: assetDisplay.symbol,
      tokenDecimals: assetDisplay.decimals,
      callbackProxy: proxyFor(asset.chainKey),
      scanFromBlock: scanFor(asset.chainKey),
    },
    scan: { lasnaFromBlock: config.scan.lasnaFromBlock, lookbackBlocks: config.scan.lookbackBlocks },
    reactive: { chainId: CHAIN_IDS.lasna, rc: configuredAddress(config.reactive.reactiveContract) ?? '', deployBlock: config.scan.lasnaFromBlock },
  }
}

export interface AggregatedOrderRow extends OrderRow {
  market: Market
}

/** One board query from /orders; per-row token labels use the shared catalog. */
export function useAllOrders(): OrdersResult<AggregatedOrderRow> {
  const orders = useOrders()
  const registry = useTokenRegistry()
  const rows: AggregatedOrderRow[] = (orders.data ?? []).map((row) => {
    const market = marketFromOrder(row.order)
    const p = venueOfOrder(row.order, 'payment')
    const a = venueOfOrder(row.order, 'asset')
    const pDisplay = deriveTokenDisplay(p.chainKey, p.token, registry.data)
    const aDisplay = deriveTokenDisplay(a.chainKey, a.token, registry.data)
    return {
      ...row,
      market: {
        ...market,
        payment: { ...market.payment, tokenSymbol: pDisplay.symbol, tokenDecimals: pDisplay.decimals },
        asset: { ...market.asset, tokenSymbol: aDisplay.symbol, tokenDecimals: aDisplay.decimals },
      },
    }
  })
  return { ...orders, data: orders.data ? rows : undefined }
}

/**
 * Allowance is deliberately still a fresh on-chain read: the backend holds no
 * keys and approve/lock must never be prepared against a cached number.
 */
export function useAllowance(chain: ChainKey, token: string | null | undefined, spender: string | null | undefined, owner?: string | null) {
  const address = configuredAddress(token)
  const target = configuredAddress(spender)
  const client = usePublicClient({ chainId: CHAIN_IDS[chain] })
  return useQuery({
    queryKey: ['allowance', chain, address, target, owner],
    enabled: !!client && !!address && !!target && !!owner,
    staleTime: 60_000,
    refetchInterval: false,
    queryFn: async (): Promise<bigint | null> => {
      try {
        return (await client!.readContract({
          address: address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner as `0x${string}`, target as `0x${string}`],
        })) as bigint
      } catch {
        return null
      }
    },
  })
}

export function chainLabel(chain: ChainKey): string {
  return CHAIN_LABELS[chain]
}

export function chainKeys(): readonly TradingChainKey[] {
  return TRADING_CHAIN_KEYS
}

export function normalizeChainId(chainId: bigint | number): TradingChainKey | null {
  return chainKeyFromId(chainId) as TradingChainKey | null
}
