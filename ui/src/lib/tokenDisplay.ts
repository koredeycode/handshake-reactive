import { useQuery } from '@tanstack/react-query'
import { configuredAddress } from './config'
import { useMarket, type LegKind } from './markets'
import { useTokenMeta } from './queries'
import type { ChainKey } from './chains'

export interface TokenDisplayEntry {
  name: string
  symbol: string
  decimals: number
  mark: string
  color: string
}

export type TokenRegistry = Record<ChainKey, Record<string, TokenDisplayEntry>>

const EMPTY: TokenRegistry = { base: {}, unichain: {}, lasna: {} }

/**
 * Presentation metadata keyed by chain and live token address. The name,
 * symbol and decimals match the ERC-20 contracts; the mark is a plain letter
 * pair derived from the real symbol. On-chain reads stay authoritative.
 */
async function loadTokens(): Promise<TokenRegistry> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}tokens.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as Partial<TokenRegistry>
    return {
      base: json.base ?? {},
      unichain: json.unichain ?? {},
      lasna: json.lasna ?? {},
    }
  } catch {
    return EMPTY
  }
}

export function useTokenRegistry() {
  const { market } = useMarket()
  return useQuery({
    queryKey: ['token-registry', market.id],
    queryFn: loadTokens,
    staleTime: Infinity,
  })
}

const ROLE_STYLE: Record<LegKind, { mark: string; color: string; name: string }> = {
  payment: { mark: 'US', color: '#e11d62', name: 'Test USD' },
  asset: { mark: 'AS', color: '#4f46e5', name: 'Test Asset' },
}

export function useTokenDisplay(kind: LegKind): TokenDisplayEntry & { address: string | null } {
  const { chainKeyFor, legConfig } = useMarket()
  const registry = useTokenRegistry()
  const onchain = useTokenMeta(kind)
  const chain = chainKeyFor(kind)
  const address = configuredAddress(legConfig(kind).token)

  const entry = address
    ? Object.entries(registry.data?.[chain] ?? {}).find(
        ([key]) => key.toLowerCase() === address.toLowerCase(),
      )?.[1]
    : undefined
  const leg = legConfig(kind)
  const roleStyle = ROLE_STYLE[kind]
  const fallback: TokenDisplayEntry = {
    name: leg.tokenSymbol === 'tUSD' || leg.tokenSymbol === 'tASSET' ? roleStyle.name : leg.tokenSymbol,
    symbol: leg.tokenSymbol,
    decimals: leg.tokenDecimals,
    mark: roleStyle.mark,
    color: roleStyle.color,
  }

  return {
    name: entry?.name ?? fallback.name,
    symbol: onchain.data?.symbol ?? entry?.symbol ?? fallback.symbol,
    decimals: onchain.data?.decimals ?? entry?.decimals ?? fallback.decimals,
    mark: entry?.mark ?? fallback.mark,
    color: entry?.color ?? fallback.color,
    address,
  }
}
