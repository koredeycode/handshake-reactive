import { useQueries, useQuery } from '@tanstack/react-query'
import { useBalance, usePublicClient } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS } from './chains'
import { configuredAddress } from './config'
import { assetEscrowAbi, erc20Abi, paymentEscrowAbi, payerAbi, reactiveAbi } from './contracts'
import { isEmptyOrder } from './format'
import { useMarket, useMarketConfig, type LegKind } from './markets'
import { isOrderTerminal } from './status'
import type { Leg, Order, Venues } from './types'

export type { LegKind } from './markets'

/**
 * viem's inferred generics are excellent but verbose when a query spans three
 * chains and several ABI overloads. These narrow local interfaces keep the
 * network layer honest without weakening what components see.
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

export interface OrdersResult {
  data?: OrderRow[]
  isLoading: boolean
  isError: boolean
  error: Error | null
  isFetching: boolean
  refetch: () => Promise<unknown>
}

/**
 * The order board used to refetch orderCount + every orderIds + every getOrder
 * (1 + 2N eth_calls on Lasna, which has no Multicall3) every 5s on every page.
 * IDs change only when a trade is created, so they live in a slow shared
 * query; each order uses the SAME ['order', id] key as the detail page and
 * stops polling on its own once it is terminal.
 */
export function useOrders(): OrdersResult {
  const config = useMarketConfig()
  const { market } = useMarket()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)
  const enabled = !!client && !!rc

  const idsQuery = useQuery({
    queryKey: ['order-ids', market.id, rc],
    enabled,
    staleTime: 60_000,
    refetchInterval: 30_000, // new orders appear within 30s, or on Refresh
    queryFn: async (): Promise<Hex[]> => {
      const c = client!
      const count = (await c.readContract({
        address: rc,
        abi: reactiveAbi,
        functionName: 'orderCount',
      })) as bigint
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
      queryKey: ['order', market.id, id, rc],
      enabled,
      staleTime: 5_000,
      refetchInterval: (query: { state: { data?: Order | null } }) =>
        isOrderTerminal(query.state.data) ? false : 5_000,
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
    // Newest first: orderIds are appended on creation.
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

export function useOrder(orderId?: Hex | null, options?: { enabled?: boolean }) {
  const config = useMarketConfig()
  const { market } = useMarket()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)

  return useQuery({
    queryKey: ['order', market.id, orderId, rc],
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

export function useVenues() {
  const config = useMarketConfig()
  const { market } = useMarket()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)

  return useQuery({
    queryKey: ['venues', market.id, rc],
    enabled: !!client && !!rc,
    staleTime: 30_000,
    queryFn: async (): Promise<Venues | null> => {
      try {
        return (await client!.readContract({
          address: rc,
          abi: reactiveAbi,
          functionName: 'venues',
        })) as unknown as Venues
      } catch {
        return null
      }
    },
  })
}

export function useLeg(kind: LegKind, orderId?: Hex | null, seller?: Hex | null) {
  const config = useMarketConfig()
  const { market, chainKeyFor } = useMarket()
  const escrow = configuredAddress(kind === 'payment' ? config.base.paymentEscrow : config.unichain.assetEscrow)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor(kind)] }))

  return useQuery({
    queryKey: ['leg', market.id, kind, orderId, seller, escrow],
    enabled: !!client && !!escrow && !!orderId,
    staleTime: 5_000,
    // Leg state 2 = RELEASED, 3 = REFUNDED: nothing else can happen there.
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state !== undefined && state >= 2n ? false : 8_000
    },
    queryFn: async (): Promise<Leg | null> => {
      try {
        if (kind === 'asset') {
          try {
            const raced = (await client!.readContract({
              address: escrow,
              abi: assetEscrowAbi,
              functionName: 'getLeg',
              args: [orderId, seller ?? '0x0000000000000000000000000000000000000000'],
            })) as unknown as Leg
            return raced
          } catch {
            // Fall back to the non-race single-leg getter.
          }
        }
        return (await client!.readContract({
          address: escrow,
          abi: kind === 'payment' ? paymentEscrowAbi : assetEscrowAbi,
          functionName: 'getLeg',
          args: [orderId],
        })) as unknown as Leg
      } catch {
        return null
      }
    },
  })
}

export function useTokenMeta(kind: LegKind) {
  const config = useMarketConfig()
  const { market, chainKeyFor, legConfig } = useMarket()
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor(kind)] }))

  return useQuery({
    queryKey: ['token-meta', market.id, kind, token],
    enabled: !!client && !!token,
    staleTime: Infinity,
    queryFn: async (): Promise<{ decimals: number; symbol: string }> => {
      // Mirrors the market registry; never a stand-in brand if the read fails.
      const leg = legConfig(kind)
      const fallback = { decimals: leg.tokenDecimals, symbol: leg.tokenSymbol }
      try {
        const [decimals, symbol] = await Promise.all([
          client!.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
          client!.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
        ])
        return { decimals: Number(decimals), symbol: String(symbol) }
      } catch {
        return fallback
      }
    },
  })
}

export function useTokenBalance(kind: LegKind, owner?: Hex | null) {
  const config = useMarketConfig()
  const { market, chainKeyFor } = useMarket()
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor(kind)] }))

  return useQuery({
    queryKey: ['token-balance', market.id, kind, owner, token],
    enabled: !!client && !!token && !!owner,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint | null> => {
      try {
        return (await client!.readContract({
          address: token,
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

export function useAllowance(kind: LegKind, owner?: Hex | null) {
  const config = useMarketConfig()
  const { market, chainKeyFor } = useMarket()
  const spender = configuredAddress(kind === 'payment' ? config.base.paymentEscrow : config.unichain.assetEscrow)
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor(kind)] }))

  return useQuery({
    queryKey: ['allowance', market.id, kind, owner, token, spender],
    enabled: !!client && !!token && !!spender && !!owner,
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint | null> => {
      try {
        return (await client!.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [owner, spender],
        })) as bigint
      } catch {
        return null
      }
    },
  })
}

export interface HealthRow {
  /** Role-keyed: the underlying chains come from the selected market. */
  key: 'lasna' | 'payment' | 'asset'
  target: string | null
  payer: string | null
  debt?: bigint
  reserves?: bigint
  balance?: bigint
  tokenBalance?: bigint
  error?: string
}

export function useHealth() {
  const config = useMarketConfig()
  const { market, chainKeyFor } = useMarket()
  const lasnaClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const paymentClient = looseClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor('payment')] }))
  const assetClient = looseClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor('asset')] }))

  return useQuery({
    queryKey: [
      'health',
      market.id,
      config.reactive.reactiveContract,
      config.base.paymentEscrow,
      config.unichain.assetEscrow,
    ],
    staleTime: 10_000,
    refetchInterval: 15_000, // dev-only panel; was 5s
    queryFn: async (): Promise<HealthRow[]> => {
      const definitions: Array<{
        key: HealthRow['key']
        client: LooseClient | null
        payer: string | null
        target: string | null
        token?: string | null
      }> = [
        {
          key: 'lasna',
          client: lasnaClient,
          payer: configuredAddress(config.reactive.systemContract),
          target: configuredAddress(config.reactive.reactiveContract),
        },
        {
          key: 'payment',
          client: paymentClient,
          payer: configuredAddress(config.base.callbackProxy),
          target: configuredAddress(config.base.paymentEscrow),
          token: configuredAddress(config.base.paymentToken),
        },
        {
          key: 'asset',
          client: assetClient,
          payer: configuredAddress(config.unichain.callbackProxy),
          target: configuredAddress(config.unichain.assetEscrow),
          token: configuredAddress(config.unichain.assetToken),
        },
      ]

      return Promise.all(
        definitions.map(async (def): Promise<HealthRow> => {
          const row: HealthRow = { key: def.key, target: def.target, payer: def.payer }
          if (!def.client || !def.payer || !def.target) {
            row.error = 'addresses not configured'
            return row
          }
          const results = await Promise.allSettled([
            def.client.readContract({ address: def.payer, abi: payerAbi, functionName: 'debt', args: [def.target] }),
            def.client.readContract({ address: def.payer, abi: payerAbi, functionName: 'reserves', args: [def.target] }),
            def.client.getBalance({ address: def.target as Address }),
            def.token
              ? def.client.readContract({ address: def.token, abi: erc20Abi, functionName: 'balanceOf', args: [def.target] })
              : Promise.resolve(undefined),
          ])
          if (results[0].status === 'fulfilled') row.debt = results[0].value as bigint
          if (results[1].status === 'fulfilled') row.reserves = results[1].value as bigint
          if (results[2].status === 'fulfilled') row.balance = results[2].value as bigint
          if (results[3].status === 'fulfilled') row.tokenBalance = results[3].value as bigint
          const failures = results.filter((r) => r.status === 'rejected')
          if (failures.length > 0 && failures.length === results.length) row.error = 'RPC read failed'
          return row
        }),
      )
    },
  })
}

export function useNativeBalances(address?: Hex | null) {
  const { market, chainKeyFor } = useMarket()
  const enabled = !!address
  const query = { enabled, refetchInterval: 15_000, staleTime: 10_000 }
  const owner = address as Address | undefined
  const scope = (role: string) => `${market.id}:native:${role}`
  const lasna = useBalance({
    address: owner,
    chainId: CHAIN_IDS.lasna,
    scopeKey: scope('lasna'),
    query,
  })
  const payment = useBalance({
    address: owner,
    chainId: CHAIN_IDS[chainKeyFor('payment')],
    scopeKey: scope('payment'),
    query,
  })
  const asset = useBalance({
    address: owner,
    chainId: CHAIN_IDS[chainKeyFor('asset')],
    scopeKey: scope('asset'),
    query,
  })
  return {
    lasna: lasna.data,
    payment: payment.data,
    asset: asset.data,
    // Legacy aliases for callers that still think in chain slots.
    base: payment.data,
    unichain: asset.data,
  }
}
