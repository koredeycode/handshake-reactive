import { useQuery } from '@tanstack/react-query'
import { configuredAddress, useConfig } from './config'
import { useTokenMeta, type LegKind } from './queries'

export interface TokenDisplayEntry {
  name: string
  symbol: string
  decimals: number
  mark: string
  color: string
}

export type TokenRegistry = {
  base: Record<string, TokenDisplayEntry>
  unichain: Record<string, TokenDisplayEntry>
}

const EMPTY: TokenRegistry = { base: {}, unichain: {} }
/** Fallbacks mirror the deployed contracts, so a failed metadata fetch never invents a brand. */
const FALLBACK: Record<LegKind, TokenDisplayEntry> = {
  payment: { name: 'Test USD', symbol: 'tUSD', decimals: 6, mark: 'US', color: '#e11d62' },
  asset: { name: 'Test Asset', symbol: 'tASSET', decimals: 18, mark: 'AS', color: '#4f46e5' },
}

/**
 * Presentation metadata keyed by chain and live token address. The name,
 * symbol and decimals match the ERC-20 contracts; the mark is a plain letter
 * pair derived from the real symbol. No external images or invented branding.
 */
async function loadTokens(): Promise<TokenRegistry> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}tokens.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as Partial<TokenRegistry>
    return {
      base: json.base ?? {},
      unichain: json.unichain ?? {},
    }
  } catch {
    return EMPTY
  }
}

export function useTokenRegistry() {
  return useQuery({
    queryKey: ['token-registry'],
    queryFn: loadTokens,
    staleTime: Infinity,
  })
}

export function useTokenDisplay(kind: LegKind): TokenDisplayEntry & { address: string | null } {
  const config = useConfig()
  const registry = useTokenRegistry()
  const onchain = useTokenMeta(kind)
  const chain = kind === 'payment' ? 'base' : 'unichain'
  const address = configuredAddress(
    kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken,
  )

  const entry = address
    ? Object.entries(registry.data?.[chain] ?? {}).find(
        ([key]) => key.toLowerCase() === address.toLowerCase(),
      )?.[1]
    : undefined
  const fallback = FALLBACK[kind]

  return {
    name: entry?.name ?? fallback.name,
    symbol: entry?.symbol ?? onchain.data?.symbol ?? fallback.symbol,
    decimals: entry?.decimals ?? onchain.data?.decimals ?? fallback.decimals,
    mark: entry?.mark ?? fallback.mark,
    color: entry?.color ?? fallback.color,
    address,
  }
}
