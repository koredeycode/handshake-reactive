import { useQuery } from '@tanstack/react-query'
import { useBalance, usePublicClient } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS } from './chains'
import { configuredAddress, useConfig } from './config'
import { assetEscrowAbi, erc20Abi, paymentEscrowAbi, payerAbi, reactiveAbi } from './contracts'
import { isEmptyOrder } from './format'
import type { Leg, Order, Venues } from './types'

/**
 * viem's inferred generics are excellent but verbose when a query spans three
 * chains and several ABI overloads. These narrow local interfaces keep the
 * network layer honest without weakening what components see.
 */
export interface LooseClient {
  readContract: (args: Record<string, unknown>) => Promise<unknown>
  multicall: (args: Record<string, unknown>) => Promise<Array<{ result?: unknown }>>
  getBalance: (args: Record<string, unknown>) => Promise<bigint>
}

export function looseClient(client: unknown): LooseClient | null {
  return (client ?? null) as LooseClient | null
}

export interface OrderRow {
  id: Hex
  order: Order
}

export function useOrders() {
  const config = useConfig()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)

  return useQuery({
    queryKey: ['orders', rc],
    enabled: !!client && !!rc,
    refetchInterval: 5_000,
    queryFn: async (): Promise<OrderRow[]> => {
      const c = client!
      const count = (await c.readContract({
        address: rc,
        abi: reactiveAbi,
        functionName: 'orderCount',
      })) as bigint
      const n = Number(count)
      if (n <= 0) return []
      const idResults = await c.multicall({
        contracts: Array.from({ length: n }, (_, i) => ({
          address: rc,
          abi: reactiveAbi,
          functionName: 'orderIds',
          args: [BigInt(i)],
        })),
        allowFailure: false,
      })
      const ids = idResults.map((r) => r.result as Hex)
      const orderResults = await c.multicall({
        contracts: ids.map((id) => ({
          address: rc,
          abi: reactiveAbi,
          functionName: 'getOrder',
          args: [id],
        })),
        allowFailure: false,
      })
      return ids.map((id, i) => ({ id, order: orderResults[i].result as unknown as Order }))
    },
  })
}

export function useOrder(orderId?: Hex | null) {
  const config = useConfig()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)

  return useQuery({
    queryKey: ['order', orderId, rc],
    enabled: !!client && !!rc && !!orderId,
    refetchInterval: 2_000,
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
  const config = useConfig()
  const client = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const rc = configuredAddress(config.reactive.reactiveContract)

  return useQuery({
    queryKey: ['venues', rc],
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

export type LegKind = 'payment' | 'asset'

export function useLeg(kind: LegKind, orderId?: Hex | null, seller?: Hex | null) {
  const config = useConfig()
  const baseClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.base }))
  const unichainClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.unichain }))
  const escrow = configuredAddress(kind === 'payment' ? config.base.paymentEscrow : config.unichain.assetEscrow)
  const client = kind === 'payment' ? baseClient : unichainClient

  return useQuery({
    queryKey: ['leg', kind, orderId, seller, escrow],
    enabled: !!client && !!escrow && !!orderId,
    refetchInterval: 2_000,
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
  const config = useConfig()
  const baseClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.base }))
  const unichainClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.unichain }))
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const client = kind === 'payment' ? baseClient : unichainClient

  return useQuery({
    queryKey: ['token-meta', kind, token],
    enabled: !!client && !!token,
    staleTime: Infinity,
    queryFn: async (): Promise<{ decimals: number; symbol: string }> => {
      const fallback = kind === 'payment' ? { decimals: 6, symbol: 'TestUSD' } : { decimals: 18, symbol: 'TEST' }
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
  const config = useConfig()
  const baseClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.base }))
  const unichainClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.unichain }))
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const client = kind === 'payment' ? baseClient : unichainClient

  return useQuery({
    queryKey: ['token-balance', kind, owner, token],
    enabled: !!client && !!token && !!owner,
    refetchInterval: 10_000,
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
  const config = useConfig()
  const baseClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.base }))
  const unichainClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.unichain }))
  const spender = configuredAddress(kind === 'payment' ? config.base.paymentEscrow : config.unichain.assetEscrow)
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const client = kind === 'payment' ? baseClient : unichainClient

  return useQuery({
    queryKey: ['allowance', kind, owner, token, spender],
    enabled: !!client && !!token && !!spender && !!owner,
    refetchInterval: 4_000,
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
  key: 'lasna' | 'base' | 'unichain'
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
  const lasnaClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const baseClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.base }))
  const unichainClient = looseClient(usePublicClient({ chainId: CHAIN_IDS.unichain }))

  return useQuery({
    queryKey: [
      'health',
      config.reactive.reactiveContract,
      config.base.paymentEscrow,
      config.unichain.assetEscrow,
    ],
    refetchInterval: 5_000,
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
          key: 'base',
          client: baseClient,
          payer: configuredAddress(config.base.callbackProxy),
          target: configuredAddress(config.base.paymentEscrow),
          token: configuredAddress(config.base.paymentToken),
        },
        {
          key: 'unichain',
          client: unichainClient,
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
  const enabled = !!address
  const lasna = useBalance({ address: address as Address | undefined, chainId: CHAIN_IDS.lasna, query: { enabled } })
  const base = useBalance({ address: address as Address | undefined, chainId: CHAIN_IDS.base, query: { enabled } })
  const unichain = useBalance({ address: address as Address | undefined, chainId: CHAIN_IDS.unichain, query: { enabled } })
  return { lasna: lasna.data, base: base.data, unichain: unichain.data }
}
