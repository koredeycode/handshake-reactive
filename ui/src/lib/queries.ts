import { useQueries, useQuery } from '@tanstack/react-query'
import { useBalance, usePublicClient, useReadContracts } from 'wagmi'
import type { Address, Hex } from 'viem'
import {
  CHAIN_IDS,
  CHAIN_LABELS,
  TRADING_CHAIN_KEYS,
  chainKeyFromId,
  type ChainKey,
  type TradingChainKey,
} from './chains'
import { configuredAddress, DEFAULT_CONFIG, useConfig, type AppConfig } from './config'
import { assetEscrowAbi, erc20Abi, paymentEscrowAbi, payerAbi, reactiveAbi } from './contracts'
import { isEmptyOrder } from './format'
import { pairId, venueOfOrder, type LegVenue } from './venue'
import { deriveTokenDisplay, useTokenRegistry } from './tokenDisplay'
import { useTradeTicket, type TicketKind } from './tradeTicket'
import { isOrderTerminal } from './status'
import { useVenues } from './venues'
import type { Market } from './markets'
import type { Leg, Order } from './types'

export type { TicketKind as LegKind } from './tradeTicket'

/**
 * viem's inferred generics are verbose when a query spans four chains and
 * several ABI overloads. These narrow local interfaces keep the network layer
 * honest without weakening what components see.
 */
export interface LooseClient {
  readContract: (args: Record<string, unknown>) => Promise<unknown>
  getBalance: (args: Record<string, unknown>) => Promise<bigint>
}

export function looseClient(client: unknown): LooseClient | null {
  return (client ?? null) as LooseClient | null
}

export interface OrderRow {
  id: Hex
  order: Order
  /** orderIds(i) index: higher means created later on the reactive ledger. */
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

/** IDs change only when a trade is created; orders stop polling once terminal. */
export function useOrders(): OrdersResult {
  const config = useConfig()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)
  const enabled = !!client && !!rc

  const idsQuery = useQuery({
    queryKey: ['order-ids', rc],
    enabled,
    staleTime: 60_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Hex[]> => {
      const c = client!
      const count = (await c.readContract({ address: rc, abi: reactiveAbi, functionName: 'orderCount' })) as bigint
      const n = Number(count)
      if (n <= 0) return []
      return Promise.all(
        Array.from({ length: n }, (_, i) =>
          c.readContract({
            address: rc,
            abi: reactiveAbi,
            functionName: 'orderIds',
            args: [BigInt(i)],
          }) as Promise<Hex>,
        ),
      )
    },
  })

  const ids = idsQuery.data ?? []
  const orderQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['order', rc, id],
      enabled,
      staleTime: 5_000,
      refetchInterval: (query: { state: { data?: Order | null } }) => (isOrderTerminal(query.state.data) ? false : 5_000),
      queryFn: async (): Promise<Order | null> => {
        const result = (await client!.readContract({
          address: rc,
          abi: reactiveAbi,
          functionName: 'getOrder',
          args: [id],
        })) as unknown as Order
        return isEmptyOrder(result) ? null : result
      },
    })),
  })

  const rows: OrderRow[] = ids
    .map((id, i) => ({ id, order: orderQueries[i]?.data, createdIndex: i }))
    .filter((row): row is OrderRow => !!row.order)
    .sort((a, b) => b.createdIndex - a.createdIndex)

  return {
    data: idsQuery.data && rows.length === ids.length ? rows : undefined,
    isLoading: idsQuery.isLoading || orderQueries.some((q) => q.isLoading),
    isError: idsQuery.isError || orderQueries.some((q) => q.isError),
    error: (idsQuery.error ?? orderQueries.find((q) => q.isError)?.error ?? null) as Error | null,
    isFetching: idsQuery.isFetching || orderQueries.some((q) => q.isFetching),
    refetch: async () => {
      await Promise.all([idsQuery.refetch(), ...orderQueries.map((q) => q.refetch())])
    },
  }
}

/** Build display data for a row entirely from the order's own venue tuple. */
export function marketFromOrder(order: Order): Market {
  const payment = venueOfOrder(order, 'payment')
  const asset = venueOfOrder(order, 'asset')
  const config = defaultConfig()
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

/** Non-hook config for pure helpers; falls back to the static defaults. */
function defaultConfig(): AppConfig {
  return DEFAULT_CONFIG
}

export interface AggregatedOrderRow extends OrderRow {
  market: Market
}

/** One RC, so the board simply reads it once and derives each row's venue. */
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

export function useOrder(orderId?: Hex | null, options?: { enabled?: boolean }) {
  const config = useConfig()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)

  return useQuery({
    queryKey: ['order', rc, orderId],
    enabled: !!client && !!rc && !!orderId && (options?.enabled ?? true),
    staleTime: 5_000,
    refetchInterval: (query) => (isOrderTerminal(query.state.data) ? false : 5_000),
    queryFn: async (): Promise<Order | null> => {
      const result = (await client!.readContract({
        address: rc,
        abi: reactiveAbi,
        functionName: 'getOrder',
        args: [orderId],
      })) as unknown as Order
      return isEmptyOrder(result) ? null : result
    },
  })
}

/** Escrow + chain for one leg of a specific order, never global state. */
export function useLeg(
  kind: TicketKind,
  orderId?: Hex | null,
  seller?: Hex | null,
  venue?: LegVenue | null,
  stopPolling = false,
) {
  const chainKey = venue?.chainKey ?? 'base'
  const escrow = configuredAddress(venue?.escrow)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chainKey] }))
  const isPayment = kind === 'payment'

  return useQuery({
    queryKey: ['leg', chainKey, escrow, kind, orderId, seller],
    enabled: !!client && !!escrow && !!orderId,
    staleTime: 5_000,
    refetchInterval: (query) => {
      if (stopPolling) return false
      const state = query.state.data?.state
      return state !== undefined && state >= 2n ? false : 8_000
    },
    queryFn: async (): Promise<Leg | null> => {
      try {
        return (await client!.readContract({
          address: escrow,
          abi: isPayment ? paymentEscrowAbi : assetEscrowAbi,
          functionName: 'getLeg',
          args: isPayment ? [orderId] : [orderId, seller ?? '0x0000000000000000000000000000000000000000'],
        })) as unknown as Leg
      } catch {
        return null
      }
    },
  })
}

/** On-chain symbol/decimals check for an arbitrary token on an explicit chain. */
export function useTokenMeta(chain: ChainKey, token?: string | null) {
  const address = configuredAddress(token)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chain] }))
  return useQuery({
    queryKey: ['token-meta', chain, address],
    enabled: !!client && !!address,
    staleTime: Infinity,
    queryFn: async (): Promise<{ decimals: number; symbol: string } | null> => {
      try {
        const [decimals, symbol] = await Promise.all([
          client!.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
          client!.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
        ])
        return { decimals: Number(decimals), symbol: String(symbol) }
      } catch {
        return null
      }
    },
  })
}

/** Balance of any ERC-20 on an explicit chain (faucet, ticket, legs). */
export function useErc20Balance(chain: ChainKey, token?: string | null, owner?: Hex | null) {
  const address = configuredAddress(token)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chain] }))
  return useQuery({
    queryKey: ['token-balance', chain, address, owner],
    enabled: !!client && !!address && !!owner,
    staleTime: 60_000,
    refetchInterval: false,
    queryFn: async (): Promise<bigint | null> => {
      try {
        return (await client!.readContract({
          address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [owner],
        })) as bigint
      } catch {
        return null
      }
    },
  })
}

export function useTokenBalance(chain: ChainKey, token?: string | null, owner?: Hex | null) {
  return useErc20Balance(chain, token, owner)
}

export function useAllowance(chain: ChainKey, token: string | null | undefined, spender: string | null | undefined, owner?: Hex | null) {
  const address = configuredAddress(token)
  const target = configuredAddress(spender)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chain] }))
  return useQuery({
    queryKey: ['allowance', chain, address, target, owner],
    enabled: !!client && !!address && !!target && !!owner,
    staleTime: 60_000,
    refetchInterval: false,
    queryFn: async (): Promise<bigint | null> => {
      try {
        return (await client!.readContract({
          address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner, target],
        })) as bigint
      } catch {
        return null
      }
    },
  })
}

/**
 * Wallet discovery for curated + user-confirmed custom tokens. Balances are
 * read with multicall where the chain declares Multicall3, kept stale for a
 * long time, and never polled.
 */
export function useDiscoveredBalances(
  chain: TradingChainKey,
  addresses: readonly string[],
  owner?: Hex | null,
): Record<string, bigint | null> {
  const normalized = addresses.filter((address) => !!configuredAddress(address)).map((address) => address.toLowerCase())
  const contracts = normalized.map((address) => ({
    address: address as Address,
    abi: erc20Abi,
    functionName: 'balanceOf' as const,
    args: owner ? [owner as Address] : [],
    chainId: CHAIN_IDS[chain],
  }))
  const query = useReadContracts({
    contracts,
    query: {
      enabled: !!owner && contracts.length > 0,
      staleTime: 60_000,
      gcTime: Infinity,
      retry: false,
    },
  }) as unknown as { data?: readonly { result?: unknown }[] }
  const out: Record<string, bigint | null> = {}
  normalized.forEach((address, index) => {
    const result = query.data?.[index]?.result
    out[address] = typeof result === 'bigint' ? result : null
  })
  return out
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

export function useHealth() {
  const config = useConfig()
  const venues = useVenues()
  const ticket = useTradeTicket()
  const lasnaClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const paymentChain = ticket.chainFor('payment')
  const assetChain = ticket.chainFor('asset')
  const paymentVenue = venues.byChain(paymentChain)
  const assetVenue = venues.byChain(assetChain)
  const paymentClient = looseClient(usePublicClient({ chainId: CHAIN_IDS[paymentChain] }))
  const assetClient = looseClient(usePublicClient({ chainId: CHAIN_IDS[assetChain] }))

  const definitions: Array<{
    key: HealthRow['key']
    chainKey: ChainKey
    client: LooseClient | null
    payer: string | null
    target: string | null
  }> = [
    {
      key: 'lasna',
      chainKey: 'lasna',
      client: lasnaClient,
      payer: configuredAddress(config.reactive.systemContract),
      target: configuredAddress(config.reactive.reactiveContract),
    },
    {
      key: 'payment',
      chainKey: paymentChain,
      client: paymentClient,
      payer: configuredAddress(config.chains[paymentChain]?.callbackProxy),
      target: paymentVenue?.paymentEscrow ?? null,
    },
    {
      key: 'asset',
      chainKey: assetChain,
      client: assetClient,
      payer: configuredAddress(config.chains[assetChain]?.callbackProxy),
      target: assetVenue?.assetEscrow ?? null,
    },
  ]

  const results = useQueries({
    queries: definitions.map((def) => ({
      queryKey: ['health', def.key, def.chainKey, def.payer, def.target],
      staleTime: 10_000,
      refetchInterval: 15_000,
      queryFn: async (): Promise<HealthRow> => {
        const row: HealthRow = { key: def.key, chainKey: def.chainKey, target: def.target, payer: def.payer }
        if (!def.client || !def.payer || !def.target) {
          row.error = 'addresses not configured'
          return row
        }
        const checks = await Promise.allSettled([
          def.client.readContract({ address: def.payer, abi: payerAbi, functionName: 'debt', args: [def.target] }),
          def.client.readContract({ address: def.payer, abi: payerAbi, functionName: 'reserves', args: [def.target] }),
          def.client.getBalance({ address: def.target as Address }),
        ])
        if (checks[0].status === 'fulfilled') row.debt = checks[0].value as bigint
        if (checks[1].status === 'fulfilled') row.reserves = checks[1].value as bigint
        if (checks[2].status === 'fulfilled') row.balance = checks[2].value as bigint
        if (checks.every((check) => check.status === 'rejected')) row.error = 'RPC read failed'
        return row
      },
    })),
  })

  return {
    data: results.map((result) => result.data).filter((row): row is HealthRow => !!row),
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    dataUpdatedAt: Math.max(0, ...results.map((result) => result.dataUpdatedAt)),
  }
}

export function useNativeBalances(address?: Hex | null) {
  const enabled = !!address
  const query = { enabled, staleTime: 60_000, refetchInterval: false as const }
  const owner = address as Address | undefined
  const lasna = useBalance({ address: owner, chainId: CHAIN_IDS.lasna, query })
  const base = useBalance({ address: owner, chainId: CHAIN_IDS.base, query })
  const unichain = useBalance({ address: owner, chainId: CHAIN_IDS.unichain, query })
  const sepolia = useBalance({ address: owner, chainId: CHAIN_IDS.sepolia, query })
  return { lasna: lasna.data, base: base.data, unichain: unichain.data, sepolia: sepolia.data }
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
