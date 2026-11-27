import { useQueries, useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import {
  CHAIN_IDS,
  TRADING_CHAIN_KEYS,
  tradingChainKeyFromId,
  type TradingChainKey,
} from './chains'
import { configuredAddress, useConfig } from './config'
import { reactiveAbi } from './contracts'
import { isZeroAddress } from './format'
import type { EscrowMeta, VenueRegistration } from './types'

interface LooseLasnaClient {
  readContract: (args: Record<string, unknown>) => Promise<unknown>
}

function useLasnaClient(): LooseLasnaClient | null {
  return (usePublicClient({ chainId: CHAIN_IDS.lasna }) ?? null) as unknown as LooseLasnaClient | null
}

function useRc(): { rc: string | null; client: LooseLasnaClient | null } {
  const config = useConfig()
  return { rc: configuredAddress(config.reactive.reactiveContract), client: useLasnaClient() }
}

/** Chain ids the RC actually has venues for, in registration order. */
export function useRegisteredChainIds() {
  const { rc, client } = useRc()
  return useQuery({
    queryKey: ['registered-chain-ids', rc],
    enabled: !!rc && !!client,
    staleTime: 60_000,
    queryFn: async (): Promise<number[]> => {
      try {
        const ids = (await client!.readContract({
          address: rc,
          abi: reactiveAbi,
          functionName: 'registeredChainIds',
        })) as readonly bigint[]
        return ids.map((id) => Number(id))
      } catch {
        return []
      }
    },
  })
}

/** The single venue for one chain, read from the RC at runtime. */
export function useVenue(chainId?: number | bigint | null) {
  const { rc, client } = useRc()
  const id = chainId === undefined || chainId === null ? null : Number(chainId)
  return useQuery({
    queryKey: ['venue', rc, id],
    enabled: !!rc && !!client && !!id,
    staleTime: 60_000,
    queryFn: async (): Promise<VenueRegistration | null> => {
      try {
        const result = (await client!.readContract({
          address: rc,
          abi: reactiveAbi,
          functionName: 'venue',
          args: [BigInt(id!)],
        })) as readonly [Hex, Hex, boolean]
        const paymentEscrow = isZeroAddress(result[0]) ? null : (result[0].toLowerCase() as Hex)
        const assetEscrow = isZeroAddress(result[1]) ? null : (result[1].toLowerCase() as Hex)
        return {
          chainId: id!,
          chainKey: tradingChainKeyFromId(id!),
          paymentEscrow,
          assetEscrow,
          registered: !!result[2] && !!paymentEscrow && !!assetEscrow,
        }
      } catch {
        return null
      }
    },
  })
}

/**
 * All three catalog venues. Hook slots are fixed (three chains), so the
 * registry contents never change hook order.
 */
export function useVenues() {
  const { rc, client } = useRc()
  const results = useQueries({
    queries: TRADING_CHAIN_KEYS.map((key) => ({
      queryKey: ['venue', rc, CHAIN_IDS[key]],
      enabled: !!rc && !!client,
      staleTime: 60_000,
      queryFn: async (): Promise<VenueRegistration> => {
        const empty: VenueRegistration = {
          chainId: CHAIN_IDS[key],
          chainKey: key as TradingChainKey,
          paymentEscrow: null,
          assetEscrow: null,
          registered: false,
        }
        try {
          const result = (await client!.readContract({
            address: rc,
            abi: reactiveAbi,
            functionName: 'venue',
            args: [BigInt(CHAIN_IDS[key])],
          })) as readonly [Hex, Hex, boolean]
          const paymentEscrow = isZeroAddress(result[0]) ? null : (result[0].toLowerCase() as Hex)
          const assetEscrow = isZeroAddress(result[1]) ? null : (result[1].toLowerCase() as Hex)
          return {
            chainId: empty.chainId,
            chainKey: key,
            paymentEscrow,
            assetEscrow,
            registered: !!result[2] && !!paymentEscrow && !!assetEscrow,
          }
        } catch {
          return empty
        }
      },
    })),
  })
  const data: VenueRegistration[] = results.map((result, index) => result.data ?? {
    chainId: CHAIN_IDS[TRADING_CHAIN_KEYS[index]],
    chainKey: TRADING_CHAIN_KEYS[index],
    paymentEscrow: null,
    assetEscrow: null,
    registered: false,
  })
  return {
    data,
    isLoading: results.some((result) => result.isLoading),
    isFetching: results.some((result) => result.isFetching),
    byChain: (key: TradingChainKey) => data.find((venue) => venue.chainKey === key),
  }
}

export function useSubscriptionCount() {
  const { rc, client } = useRc()
  return useQuery({
    queryKey: ['subscription-count', rc],
    enabled: !!rc && !!client,
    staleTime: 60_000,
    queryFn: async (): Promise<number | null> => {
      try {
        const count = (await client!.readContract({
          address: rc,
          abi: reactiveAbi,
          functionName: 'subscriptionCount',
        })) as bigint
        return Number(count)
      } catch {
        return null
      }
    },
  })
}

/** Reverse lookup used by the diagnostics panel (role 1 = payment, 2 = asset). */
export function useEscrowMeta(address?: string | null) {
  const { rc, client } = useRc()
  const normalized = configuredAddress(address)
  return useQuery({
    queryKey: ['escrow-meta', rc, normalized],
    enabled: !!rc && !!client && !!normalized,
    staleTime: 60_000,
    queryFn: async (): Promise<EscrowMeta | null> => {
      try {
        const result = (await client!.readContract({
          address: rc,
          abi: reactiveAbi,
          functionName: 'escrows',
          args: [normalized],
        })) as readonly [bigint, bigint, boolean]
        return { chainId: result[0], role: result[1], registered: !!result[2] }
      } catch {
        return null
      }
    },
  })
}
