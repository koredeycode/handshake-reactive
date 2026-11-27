import { useQuery } from '@tanstack/react-query'
import type { Hex } from 'viem'
import { CHAIN_LABELS, chainKeyFromId, type ChainKey, type TradingChainKey } from './chains'
import { SEPOLIA_TOKEN_ADDRESSES } from './config'
import { truncate } from './format'
import type { Order } from './types'

export interface TokenDisplayEntry {
  name: string
  symbol: string
  decimals: number
  mark: string
  color: string
  /** Curated entries are verified; pasted ERC-20s are always labelled unverified. */
  verified: boolean
  /** Sepolia test-token addresses awaiting the deploy manifest. */
  placeholder?: boolean
}

export type TokenRegistry = Record<TradingChainKey, Record<string, TokenDisplayEntry>>

export interface ChainTokenOption extends TokenDisplayEntry {
  address: string
}

export interface TokenSelection extends TokenDisplayEntry {
  address: Hex
}

const EMPTY: TokenRegistry = { base: {}, unichain: {}, sepolia: {} }

async function loadTokens(): Promise<TokenRegistry> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}tokens.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as Partial<TokenRegistry>
    const registry: TokenRegistry = {
      base: json.base ?? {},
      unichain: json.unichain ?? {},
      sepolia: json.sepolia ?? {},
    }
    for (const list of Object.values(registry)) {
      for (const entry of Object.values(list)) entry.verified = true
    }
    // The Sepolia entries in tokens.json are placeholders. Once the deploy
    // manifest addresses are configured, remap the same display metadata.
    const sepolia = { ...registry.sepolia }
    const overrides: Array<[string, string]> = [
      ['tUSD', SEPOLIA_TOKEN_ADDRESSES.tUSD],
      ['tASSET', SEPOLIA_TOKEN_ADDRESSES.tASSET],
    ]
    for (const [symbol, address] of overrides) {
      if (!address) continue
      const found = Object.entries(sepolia).find(([, entry]) => entry.symbol === symbol)
      if (!found) continue
      if (found[0].toLowerCase() !== address.toLowerCase()) delete sepolia[found[0]]
      sepolia[address] = { ...found[1], placeholder: false }
    }
    registry.sepolia = sepolia
    return registry
  } catch {
    return EMPTY
  }
}

/** The registry is chain-keyed, so it is shared by every venue and order. */
export function useTokenRegistry() {
  return useQuery({
    queryKey: ['token-registry'],
    queryFn: loadTokens,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/** Curated tokens listed for one chain. Placeholders are opt-in (faucet only). */
export function useChainTokens(chain: ChainKey, includePlaceholders = false): ChainTokenOption[] {
  const registry = useTokenRegistry()
  if (chain === 'lasna') return []
  return Object.entries(registry.data?.[chain] ?? {})
    .filter(([, entry]) => includePlaceholders || !entry.placeholder)
    .map(([address, entry]) => ({ address, ...entry }))
    .sort((a, b) => {
      const rank = (symbol: string) => (symbol === 'tUSD' ? 0 : symbol === 'tASSET' ? 1 : 2)
      return rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol)
    })
}

export function findTokenEntry(
  registry: TokenRegistry | undefined,
  chain: ChainKey,
  address?: string | null,
): TokenDisplayEntry | undefined {
  if (!address) return undefined
  return Object.entries(registry?.[chain === 'lasna' ? 'sepolia' : chain] ?? {}).find(
    ([key]) => key.toLowerCase() === address.toLowerCase(),
  )?.[1]
}

/** Letters for an arbitrary token, used for derived marks (no invented logos). */
export function deriveMark(value?: string | null): string {
  const clean = (value ?? '').replace(/[^a-zA-Z0-9]/g, '')
  return (clean.slice(0, 2).toUpperCase() || '??').slice(0, 2)
}

/**
 * Presentation for any token address on any chain. Curated addresses get
 * their real mark/color; unknown addresses get a derived letter mark and a
 * truncated-address symbol. Full address is always available to the caller.
 */
export function deriveTokenDisplay(
  chain: ChainKey,
  address?: string | null,
  registry?: TokenRegistry,
): TokenDisplayEntry {
  const curated = findTokenEntry(registry, chain, address)
  if (curated) return curated
  const short = address ? truncate(address, 6, 4) : 'unknown token'
  return {
    name: short,
    symbol: short,
    decimals: 18,
    mark: deriveMark(address?.slice(2) ?? short),
    color: '',
    verified: false,
  }
}

/** Display for a token leg of an order, derived solely from the order's venue. */
export function useOrderTokenDisplay(order?: Order | null, kind: 'payment' | 'asset' = 'payment') {
  const registry = useTokenRegistry()
  const chainId = kind === 'payment' ? order?.venue.paymentChainId : order?.venue.assetChainId
  const chain = (chainId ? chainKeyFromId(chainId) : null) ?? 'base'
  const address = (kind === 'payment' ? order?.paymentToken : order?.assetToken) ?? null
  const entry = deriveTokenDisplay(chain, address, registry.data)
  return { ...entry, address, chain, chainLabel: CHAIN_LABELS[chain] }
}

/** Presentation for the token currently selected on a trade ticket side. */
export function curatedSelection(option: ChainTokenOption): TokenSelection {
  return { ...option, address: option.address as Hex }
}

export function customSelection(
  address: Hex,
  meta: { name: string; symbol: string; decimals: number },
): TokenSelection {
  return {
    address,
    name: meta.name || meta.symbol,
    symbol: meta.symbol || truncate(address, 6, 4),
    decimals: meta.decimals,
    mark: deriveMark(meta.symbol || address.slice(2)),
    color: '',
    verified: false,
  }
}

/** Legacy name kept for components that only have a market-like leg object. */
export function fallbackEntry(symbol: string, decimals: number): TokenDisplayEntry {
  const curated = symbol === 'tUSD'
    ? { mark: 'US', color: '#e11d62', name: 'Test USD' }
    : symbol === 'tASSET'
      ? { mark: 'AS', color: '#4f46e5', name: 'Test Asset' }
      : { mark: deriveMark(symbol), color: '', name: symbol }
  return { ...curated, symbol, decimals, verified: symbol === 'tUSD' || symbol === 'tASSET' }
}
