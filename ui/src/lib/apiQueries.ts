import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Hex } from 'viem'
import {
  fetchHealth,
  fetchOrder,
  fetchOrderEvents,
  fetchOrders,
  fetchTokens,
  fetchWalletBalances,
  fetchWalletTokens,
  useApiBaseUrl,
  type ApiChainBalances,
  type ApiHealthResponse,
  type ApiOrderDetail,
  type ApiOrderLeg,
  type ApiOrderRow,
  type ApiTokenRow,
} from './api'
import { CHAIN_IDS, type ChainKey, type TradingChainKey } from './chains'
import { ZERO_ADDRESS } from './format'
import { useRealtime } from './RealtimeProvider'
import { queryKeys } from './queryKeys'
import { useConfig } from './config'
import { useVenues } from './venues'
import { useTradeTicket, type TicketKind } from './tradeTicket'
import type { Leg, Order, VenueRegistration } from './types'

export interface OrderRow {
  id: Hex
  order: Order
  /** Keyset page order: higher means created later. */
  createdIndex: number
}

export interface OrdersResult<T extends OrderRow = OrderRow> {
  data?: T[]
  isLoading: boolean
  isError: boolean
  error: Error | null
  isFetching: boolean
  refetch: () => Promise<unknown>
}

function escrowPair(row: { paymentChainId: number | null; assetChainId: number | null }, venues: VenueRegistration[]) {
  const forChain = (chainId: number | null, role: 'payment' | 'asset') => {
    const registration = venues.find((venue) => venue.chainId === Number(chainId))
    return registration?.[`${role}Escrow`] ?? ZERO_ADDRESS
  }
  return {
    paymentChainId: BigInt(row.paymentChainId ?? 0),
    paymentEscrow: forChain(row.paymentChainId, 'payment') as Hex,
    assetChainId: BigInt(row.assetChainId ?? 0),
    assetEscrow: forChain(row.assetChainId, 'asset') as Hex,
  }
}

/** API row → the existing Order view model used across the UI. */
export function mapApiOrder(row: ApiOrderRow, venues: VenueRegistration[]): Order {
  const seller = row.seller ?? ZERO_ADDRESS
  return {
    buyer: (row.buyer ?? ZERO_ADDRESS) as Hex,
    seller: seller as Hex,
    paymentToken: (row.paymentToken ?? ZERO_ADDRESS) as Hex,
    paymentAmount: BigInt(row.paymentAmount ?? 0),
    assetToken: (row.assetToken ?? ZERO_ADDRESS) as Hex,
    assetAmount: BigInt(row.assetAmount ?? 0),
    deadline: BigInt(row.deadline ?? 0),
    paymentSeen: !!row.paymentSeen,
    assetSeen: !!row.assetSeen,
    settleRequested: !!row.settleRequested,
    refundRequested: !!row.refundRequested,
    paymentClosed: !!row.paymentClosed,
    assetClosed: !!row.assetClosed,
    // The RC tuple has two refund-intent flags; the API stores one plus closure.
    paymentRefundRequested: !!row.refundRequested && !row.paymentClosed,
    assetRefundRequested: !!row.refundRequested && !row.assetClosed,
    invalid: row.status === 'invalid' || row.status === 'cancelled',
    nonce: BigInt(row.nonce ?? 0),
    lastActionTimestamp: BigInt(Math.floor(new Date(row.updatedAt ?? 0).getTime() / 1000) || 0),
    winner: (row.winner ?? ZERO_ADDRESS) as Hex,
    assetLockCount: BigInt(row.assetLockCount ?? 0),
    paymentRequestNonce: BigInt(row.paymentRequestNonce ?? 0),
    assetRequestNonce: BigInt(row.assetRequestNonce ?? 0),
    venue: escrowPair(row, venues),
  }
}

function legState(state: ApiOrderLeg['state']): bigint {
  return state === 'released' ? 2n : state === 'refunded' ? 3n : 1n
}

function mapApiLeg(detail: ApiOrderDetail, leg: ApiOrderLeg): Leg {
  return {
    depositor: (leg.role === 'payment' ? detail.buyer ?? leg.seller : leg.seller) as Hex,
    counterparty: (leg.counterparty ?? ZERO_ADDRESS) as Hex,
    token: leg.token as Hex,
    amount: BigInt(leg.amount ?? 0),
    termsHash: (detail.termsHash ?? ZERO_ADDRESS) as Hex,
    deadline: BigInt(detail.deadline ?? 0),
    state: legState(leg.state),
    nonce: BigInt(leg.nonce ?? 0),
  }
}

export function useOrders(filters: { status?: string; chain?: number } = {}): OrdersResult {
  const base = useApiBaseUrl()
  const venues = useVenues()
  const rt = useRealtime()
  const select = useCallback(
    (response: { items: ApiOrderRow[] }) => response.items.map((row, createdIndex) => ({
      id: row.orderId as Hex,
      order: mapApiOrder(row, venues.data),
      createdIndex,
    })),
    [venues.data],
  )
  const query = useQuery({
    queryKey: queryKeys.orders(filters),
    queryFn: () => fetchOrders(filters, base),
    enabled: true,
    staleTime: 30_000,
    refetchInterval: rt.status === 'open' ? false : 60_000,
    select,
  })
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}

export function useOrderDetail(orderId?: Hex | string | null, options?: { enabled?: boolean }) {
  const base = useApiBaseUrl()
  const rt = useRealtime()
  return useQuery({
    queryKey: queryKeys.order(orderId),
    enabled: !!orderId && (options?.enabled ?? true),
    staleTime: 30_000,
    refetchInterval: rt.status === 'open' ? false : 60_000,
    queryFn: () => fetchOrder(String(orderId), base),
  })
}

/** Keeps the public `useOrder` name; data is the same Order tuple view as before. */
export function useOrder(orderId?: Hex | string | null, options?: { enabled?: boolean }) {
  const detail = useOrderDetail(orderId, options)
  const venues = useVenues()
  const data = useMemo(
    () => (detail.data ? mapApiOrder(detail.data, venues.data) : null),
    [detail.data, venues.data],
  )
  return { ...detail, data }
}

/** Raw decoded order events, kept for the dev/diagnostics surface. */
export function useOrderEvents(orderId?: Hex | string | null) {
  const base = useApiBaseUrl()
  return useQuery({
    queryKey: ['order-events', orderId],
    enabled: !!orderId,
    staleTime: 60_000,
    queryFn: () => fetchOrderEvents(String(orderId), base),
  })
}

/** One escrow leg of an order, derived from the API detail (no getLeg polling). */
export function useLeg(
  kind: TicketKind,
  orderId?: Hex | null,
  seller?: Hex | null,
  _venue?: unknown,
  _stopPolling = false,
) {
  const detail = useOrderDetail(orderId)
  const data = useMemo(() => {
    if (!detail.data) return null
    const role = kind === 'payment' ? 'payment' : 'asset'
    const target = (seller ?? ZERO_ADDRESS).toLowerCase()
    const leg = detail.data.legs.find((item) => item.role === role && (role === 'payment' || item.seller.toLowerCase() === target))
    return leg ? mapApiLeg(detail.data, leg) : null
  }, [detail.data, kind, seller])
  return { data, isLoading: detail.isLoading, isError: detail.isError, refetch: detail.refetch }
}

/** Shared wallet balance endpoint — one hook for every page and panel. */
export function useApiBalances(address?: string | null) {
  const base = useApiBaseUrl()
  const rt = useRealtime()
  return useQuery({
    queryKey: queryKeys.walletBalances(address),
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: rt.status === 'open' ? false : 60_000,
    queryFn: () => fetchWalletBalances(String(address).toLowerCase(), undefined, base),
  })
}

export function useWalletTokens(address?: string | null) {
  const base = useApiBaseUrl()
  return useQuery({
    queryKey: queryKeys.walletTokens(address),
    enabled: !!address,
    staleTime: 60_000,
    queryFn: () => fetchWalletTokens(String(address).toLowerCase(), base),
  })
}

function findToken(balances: Record<string, ApiChainBalances> | undefined, chain: ChainKey, token?: string | null) {
  if (!balances || !token) return undefined
  return balances[String(CHAIN_IDS[chain])]?.tokens.find((entry) => entry.address.toLowerCase() === token.toLowerCase())
}

export function useErc20Balance(chain: ChainKey, token?: string | null, owner?: string | null) {
  const query = useApiBalances(owner)
  const data = useMemo(() => {
    const entry = findToken(query.data?.chains, chain, token)
    return entry ? BigInt(entry.balance) : null
  }, [query.data, chain, token])
  return { ...query, data }
}

export const useTokenBalance = useErc20Balance

/** Discovery result keyed by lower-case address, matching the old helper. */
export function useDiscoveredBalances(chain: ChainKey, addresses: readonly string[], owner?: string | null): Record<string, bigint | null> {
  const query = useApiBalances(owner)
  return useMemo(() => {
    const out: Record<string, bigint | null> = {}
    for (const address of addresses) {
      const entry = findToken(query.data?.chains, chain, address)
      out[address.toLowerCase()] = entry ? BigInt(entry.balance) : null
    }
    return out
  }, [query.data, chain, addresses])
}

const NATIVE_SYMBOL: Record<ChainKey, string> = {
  lasna: 'lREACT',
  base: 'ETH',
  unichain: 'ETH',
  sepolia: 'ETH',
}

export function useNativeBalances(address?: string | null) {
  const query = useApiBalances(address)
  return useMemo(() => {
    const chains = query.data?.chains
    const make = (chain: ChainKey) => {
      const value = chains?.[String(CHAIN_IDS[chain])]?.native
      if (value === undefined) return undefined
      return { value: BigInt(value), symbol: NATIVE_SYMBOL[chain], decimals: 18, formatted: value }
    }
    return { lasna: make('lasna'), base: make('base'), unichain: make('unichain'), sepolia: make('sepolia') }
  }, [query.data])
}

export function useTokenCatalog(filters: { chainId?: number; verified?: boolean } = {}) {
  const base = useApiBaseUrl()
  return useQuery({
    queryKey: queryKeys.tokens(filters),
    queryFn: () => fetchTokens(filters, base),
    staleTime: 60_000,
  })
}

/** Token metadata now comes from the persisted API catalog, not a per-token RPC read. */
export function useTokenMeta(chain: TradingChainKey | ChainKey, token?: string | null) {
  const chainId = CHAIN_IDS[chain]
  const query = useTokenCatalog({ chainId })
  const entry = query.data?.tokens.find((item) => item.address.toLowerCase() === token?.toLowerCase())
  return {
    ...query,
    data: entry && entry.symbol && entry.decimals !== null ? { decimals: entry.decimals, symbol: entry.symbol } : null,
  }
}

export interface HealthRow {
  key: 'lasna' | 'payment' | 'asset'
  chainKey: ChainKey
  target: string | null
  payer: string | null
  debt?: bigint
  reserves?: bigint
  balance?: bigint
  tokenBalance?: bigint
  error?: string
}

/** /health supplies service health; keeper.status supplies debt/reserves. */
export function useHealth() {
  const base = useApiBaseUrl()
  const config = useConfig()
  const ticket = useTradeTicket()
  const venues = useVenues()
  const realtime = useRealtime()
  const query = useQuery<ApiHealthResponse>({
    queryKey: queryKeys.health(),
    queryFn: () => fetchHealth(base),
    staleTime: 30_000,
    refetchInterval: realtime.status === 'open' ? false : 60_000,
    retry: 1,
  })
  const data = useMemo<HealthRow[]>(() => {
    const row = (key: HealthRow['key'], chainKey: ChainKey, target: string | null, payer: string | null, chainId: number): HealthRow => {
      const keeper = realtime.keeperStatuses[chainId]
      return {
        key,
        chainKey,
        target: keeper?.target ?? target,
        payer,
        debt: keeper ? BigInt(keeper.debtWei) : undefined,
        reserves: keeper ? BigInt(keeper.reservesWei) : undefined,
        error: query.isError ? 'API health unavailable' : undefined,
      }
    }
    const paymentChain = ticket.chainFor('payment')
    const assetChain = ticket.chainFor('asset')
    return [
      row('lasna', 'lasna', config.reactive.reactiveContract, config.reactive.systemContract, CHAIN_IDS.lasna),
      row('payment', paymentChain, venues.byChain(paymentChain)?.paymentEscrow ?? null, config.chains[paymentChain]?.callbackProxy ?? null, CHAIN_IDS[paymentChain]),
      row('asset', assetChain, venues.byChain(assetChain)?.assetEscrow ?? null, config.chains[assetChain]?.callbackProxy ?? null, CHAIN_IDS[assetChain]),
    ]
  }, [config, ticket, venues.data, realtime.keeperStatuses, query.isError])

  return {
    data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    dataUpdatedAt: query.dataUpdatedAt,
  }
}

export type { ApiTokenRow }
