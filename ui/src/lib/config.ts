import { useQuery } from '@tanstack/react-query'
import { CHAIN_IDS, CHAIN_LABELS, TRADING_CHAIN_KEYS, type TradingChainKey } from './chains'
import { normalizeAddress } from './format'

/**
 * The former "markets" registry is now a chain catalog: one reactive contract,
 * three EVM chains, their callback proxies and log scan anchors. Escrow
 * addresses are deliberately absent — they are read from the reactive
 * contract's venue registry at runtime (see lib/venues.ts).
 */
export interface CatalogChain {
  key: TradingChainKey
  chainId: number
  label: string
  callbackProxy: string
  scanFromBlock: number
}

export interface AppConfig {
  reactive: {
    reactiveContract: string
    systemContract: string
    legacySystemContract: string
  }
  scan: {
    lasnaFromBlock: number
    lookbackBlocks: number
  }
  chains: Record<TradingChainKey, CatalogChain>
}

/** Curated Sepolia token addresses from the Option B deployment; VITE_* overrides win. */
export const SEPOLIA_TOKEN_ADDRESSES = {
  tUSD:
    import.meta.env.VITE_SEPOLIA_TUSD_ADDRESS || '0xD894D5bAade0C06137D45C616Cb9D2e6cbFa5fD4',
  tASSET:
    import.meta.env.VITE_SEPOLIA_TASSET_ADDRESS || '0x9ffd2f7795fa3c029548c9faeac8da5cdb79047d',
} as const

const env = import.meta.env

function chainFallback(key: TradingChainKey, proxy: string, scanFromBlock = 0): CatalogChain {
  return { key, chainId: CHAIN_IDS[key], label: CHAIN_LABELS[key], callbackProxy: proxy, scanFromBlock }
}

/** Env vars win over public/markets.json so Vercel previews can override at build time. */
export function withOverrides(config: AppConfig): AppConfig {
  const chains = { ...config.chains }
  for (const key of TRADING_CHAIN_KEYS) {
    const override = env[`VITE_${key.toUpperCase()}_PROXY` as keyof ImportMetaEnv] as string | undefined
    if (override) chains[key] = { ...chains[key], callbackProxy: override }
  }
  const blockOf = (value: string | undefined, fallback: number) => Number(value ?? fallback) || fallback
  return {
    reactive: {
      reactiveContract: env.VITE_RC_ADDRESS || config.reactive.reactiveContract,
      systemContract: env.VITE_SYSTEM_ADDRESS || config.reactive.systemContract,
      legacySystemContract: env.VITE_LEGACY_SYSTEM_ADDRESS || config.reactive.legacySystemContract,
    },
    scan: {
      lasnaFromBlock: blockOf(env.VITE_LASNA_FROM_BLOCK, config.scan.lasnaFromBlock),
      lookbackBlocks: blockOf(env.VITE_LOOKBACK_BLOCKS, config.scan.lookbackBlocks),
    },
    chains: Object.fromEntries(
      TRADING_CHAIN_KEYS.map((key) => {
        const blockVar = env[`VITE_${key.toUpperCase()}_FROM_BLOCK` as keyof ImportMetaEnv] as string | undefined
        return [key, { ...chains[key], scanFromBlock: blockOf(blockVar, chains[key].scanFromBlock) }]
      }),
    ) as AppConfig['chains'],
  }
}

/**
 * The live RC (pre-Cron100 cutover). It has no `expire` selector, so the
 * permissionless refund action must never be offered or submitted here.
 */
export const LIVE_RC_ADDRESS = '0x037cef4c80c7424b2c7fb45770990b5763f67474'

/**
 * Two-factor cutover gate for the future-only `expire` action.
 *
 * BOTH conditions must hold: the build explicitly opts in with
 * `VITE_EXPIRE_ENABLED=1` after the Cron100 RC redeploy, AND the configured RC
 * is not the known live address. An address override alone is not sufficient —
 * a stale override pointing at the live address would still revert.
 */
export function expireEnabled(config: AppConfig): boolean {
  if (env.VITE_EXPIRE_ENABLED !== '1') return false
  const rc = configuredAddress(config.reactive.reactiveContract)
  return !!rc && rc !== normalizeAddress(LIVE_RC_ADDRESS)
}

const FALLBACK: AppConfig = {
  reactive: {
    reactiveContract: LIVE_RC_ADDRESS,
    systemContract: '0x8888888888888888888888888888888888888888',
    legacySystemContract: '0x0000000000000000000000000000000000ffffff',
  },
  scan: { lasnaFromBlock: 0, lookbackBlocks: 50_000 },
  chains: {
    base: chainFallback('base', '0x476F44b11F5C942c58f4c8E3d0300E5710743585', 63_775_999),
    unichain: chainFallback('unichain', '0x775c9B990ADe401060B78D0e98684eEf8d2466C1', 68_824_600),
    sepolia: chainFallback('sepolia', '0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4', 12_222_050),
  },
}

export const DEFAULT_CONFIG = withOverrides(FALLBACK)

interface CatalogJson {
  reactiveContract?: string
  systemContract?: string
  legacySystemContract?: string
  scan?: { lasnaFromBlock?: number; lookbackBlocks?: number }
  chains?: Array<Partial<CatalogChain> & { key?: string }>
}

interface ContractsJson {
  reactive?: { reactiveContract?: string; systemContract?: string; legacySystemContract?: string }
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${name}`, { cache: 'no-cache' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function loadConfig(): Promise<AppConfig> {
  const [catalog, contracts] = await Promise.all([
    readJson<CatalogJson>('markets.json'),
    readJson<ContractsJson>('contracts.json'),
  ])
  const chains = { ...FALLBACK.chains }
  if (catalog?.chains) {
    for (const entry of catalog.chains) {
      if (!entry.key || !(entry.key in chains)) continue
      const key = entry.key as TradingChainKey
      chains[key] = {
        ...chains[key],
        callbackProxy: entry.callbackProxy || chains[key].callbackProxy,
        scanFromBlock: Number(entry.scanFromBlock ?? chains[key].scanFromBlock) || 0,
      }
    }
  }
  const base: AppConfig = {
    reactive: {
      reactiveContract:
        catalog?.reactiveContract ||
        contracts?.reactive?.reactiveContract ||
        FALLBACK.reactive.reactiveContract,
      systemContract: catalog?.systemContract || FALLBACK.reactive.systemContract,
      legacySystemContract: catalog?.legacySystemContract || FALLBACK.reactive.legacySystemContract,
    },
    scan: {
      lasnaFromBlock: Number(catalog?.scan?.lasnaFromBlock ?? FALLBACK.scan.lasnaFromBlock) || 0,
      lookbackBlocks: Number(catalog?.scan?.lookbackBlocks ?? FALLBACK.scan.lookbackBlocks) || 50_000,
    },
    chains,
  }
  return withOverrides(base)
}

export function useConfig(): AppConfig {
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: loadConfig,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return data ?? DEFAULT_CONFIG
}

export function chainConfig(config: AppConfig, key: TradingChainKey): CatalogChain {
  return config.chains[key]
}

export function configuredAddress(value?: string | null): string | null {
  const normalized = normalizeAddress(value)
  return normalized && normalized !== '0x0000000000000000000000000000000000000000' ? normalized : null
}
