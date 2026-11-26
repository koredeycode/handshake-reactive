import { useQuery } from '@tanstack/react-query'
import { configuredAddress } from './config'
import { useMarket, chainKeyFromId, type LegKind, type Market } from './markets'
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
 * pair derived from the real symbol. On-chain reads stay authoritative on
 * primary trade screens.
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

/** The registry is chain-keyed, so it is shared by every market. */
export function useTokenRegistry() {
  return useQuery({
    queryKey: ['token-registry'],
    queryFn: loadTokens,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function findTokenEntry(
  registry: TokenRegistry | undefined,
  chain: ChainKey,
  address?: string | null,
): TokenDisplayEntry | undefined {
  if (!address) return undefined
  return Object.entries(registry?.[chain] ?? {}).find(
    ([key]) => key.toLowerCase() === address.toLowerCase(),
  )?.[1]
}

const ROLE_STYLE: Record<LegKind, { mark: string; color: string; name: string }> = {
  payment: { mark: 'US', color: '#e11d62', name: 'Test USD' },
  asset: { mark: 'AS', color: '#4f46e5', name: 'Test Asset' },
}

function fallbackEntry(market: Market, kind: LegKind): TokenDisplayEntry {
  const leg = market[kind]
  const roleStyle = ROLE_STYLE[kind]
  return {
    name: leg.tokenSymbol === 'tUSD' || leg.tokenSymbol === 'tASSET' ? roleStyle.name : leg.tokenSymbol,
    symbol: leg.tokenSymbol,
    decimals: leg.tokenDecimals,
    mark: roleStyle.mark,
    color: roleStyle.color,
  }
}

/**
 * Registry-only token presentation for aggregated rows: no extra RPC calls,
 * every row uses the chain and token address of its own market.
 */
export function useMarketTokenDisplay(
  market: Market,
  kind: LegKind,
): TokenDisplayEntry & { address: string | null; chain: ChainKey } {
  const registry = useTokenRegistry()
  const leg = market[kind]
  const chain = chainKeyFromId(leg.chainId, leg.chainKey)
  const address = configuredAddress(leg.token)
  const entry = findTokenEntry(registry.data, chain, address)
  const fallback = fallbackEntry(market, kind)
  return {
    ...fallback,
    ...entry,
    address,
    chain,
  }
}

/** Primary-screen token display, with an on-chain symbol/decimals check. */
export function useTokenDisplay(
  kind: LegKind,
  marketOverride?: Market | null,
): TokenDisplayEntry & { address: string | null } {
  const { market: current } = useMarket()
  const market = marketOverride ?? current
  const registry = useTokenRegistry()
  const onchain = useTokenMeta(kind, market)
  const chain = chainKeyFromId(market[kind].chainId, market[kind].chainKey)
  const address = configuredAddress(market[kind].token)

  const entry = findTokenEntry(registry.data, chain, address)
  const fallback = fallbackEntry(market, kind)

  return {
    name: entry?.name ?? fallback.name,
    symbol: onchain.data?.symbol ?? entry?.symbol ?? fallback.symbol,
    decimals: onchain.data?.decimals ?? entry?.decimals ?? fallback.decimals,
    mark: entry?.mark ?? fallback.mark,
    color: entry?.color ?? fallback.color,
    address,
  }
}
