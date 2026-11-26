import { useQuery } from '@tanstack/react-query'
import { normalizeAddress } from './format'

export interface AppConfig {
  reactive: {
    reactiveContract: string
    systemContract: string
    legacySystemContract: string
  }
  base: {
    paymentEscrow: string
    paymentToken: string
    callbackProxy: string
  }
  unichain: {
    assetEscrow: string
    assetToken: string
    callbackProxy: string
  }
  scan: {
    lasnaFromBlock: number
    baseFromBlock: number
    unichainFromBlock: number
    lookbackBlocks: number
  }
}

const env = import.meta.env

/** Env vars win over public/contracts.json so Vercel preview deploys can override at build time. */
export function withOverrides(config: AppConfig): AppConfig {
  return {
    reactive: {
      reactiveContract: env.VITE_RC_ADDRESS || config.reactive.reactiveContract,
      systemContract: env.VITE_SYSTEM_ADDRESS || config.reactive.systemContract,
      legacySystemContract: env.VITE_LEGACY_SYSTEM_ADDRESS || config.reactive.legacySystemContract,
    },
    base: {
      paymentEscrow: env.VITE_PAYMENT_ESCROW || config.base.paymentEscrow,
      paymentToken: env.VITE_PAYMENT_TOKEN || config.base.paymentToken,
      callbackProxy: env.VITE_BASE_PROXY || config.base.callbackProxy,
    },
    unichain: {
      assetEscrow: env.VITE_ASSET_ESCROW || config.unichain.assetEscrow,
      assetToken: env.VITE_ASSET_TOKEN || config.unichain.assetToken,
      callbackProxy: env.VITE_UNICHAIN_PROXY || config.unichain.callbackProxy,
    },
    scan: {
      lasnaFromBlock: Number(env.VITE_LASNA_FROM_BLOCK ?? config.scan.lasnaFromBlock) || 0,
      baseFromBlock: Number(env.VITE_BASE_FROM_BLOCK ?? config.scan.baseFromBlock) || 0,
      unichainFromBlock: Number(env.VITE_UNICHAIN_FROM_BLOCK ?? config.scan.unichainFromBlock) || 0,
      lookbackBlocks: Number(env.VITE_LOOKBACK_BLOCKS ?? config.scan.lookbackBlocks) || 50000,
    },
  }
}

const FALLBACK: AppConfig = {
  reactive: {
    reactiveContract: '',
    systemContract: '0x8888888888888888888888888888888888888888',
    legacySystemContract: '0x0000000000000000000000000000000000ffffff',
  },
  base: {
    paymentEscrow: '',
    paymentToken: '',
    callbackProxy: '0x476F44b11F5C942c58f4c8E3d0300E5710743585',
  },
  unichain: {
    assetEscrow: '',
    assetToken: '',
    callbackProxy: '0x775c9B990ADe401060B78D0e98684eEf8d2466C1',
  },
  scan: {
    lasnaFromBlock: 0,
    baseFromBlock: 0,
    unichainFromBlock: 0,
    lookbackBlocks: 50000,
  },
}

export const DEFAULT_CONFIG = withOverrides(FALLBACK)

async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}contracts.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as Partial<AppConfig>
    return withOverrides({
      reactive: { ...FALLBACK.reactive, ...json.reactive },
      base: { ...FALLBACK.base, ...json.base },
      unichain: { ...FALLBACK.unichain, ...json.unichain },
      scan: { ...FALLBACK.scan, ...json.scan },
    })
  } catch {
    return DEFAULT_CONFIG
  }
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

export function configuredAddress(value?: string | null): string | null {
  const normalized = normalizeAddress(value)
  return normalized && normalized !== '0x0000000000000000000000000000000000000000' ? normalized : null
}
