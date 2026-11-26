import { defineChain } from 'viem'
import { baseSepolia } from 'viem/chains'

/**
 * Lasna and Unichain Sepolia are not in viem's chain list (or are named
 * differently), so we define them explicitly. All values come from PRD §11.1.
 */
export const lasna = defineChain({
  id: 5318007,
  name: 'Reactive Lasna',
  nativeCurrency: { name: 'Reactive', symbol: 'lREACT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://lasna-rpc.rnk.dev/'] },
    public: { http: ['https://lasna-rpc.rnk.dev/'] },
  },
  blockExplorers: {
    default: { name: 'Reactscan', url: 'https://lasna.reactscan.net/' },
  },
  testnet: true,
})

export const unichainSepolia = defineChain({
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.unichain.org'] },
    public: { http: ['https://sepolia.unichain.org', 'https://unichain-sepolia-rpc.publicnode.com'] },
  },
  blockExplorers: {
    default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz/' },
  },
  testnet: true,
})

export const CHAINS = {
  lasna,
  base: baseSepolia,
  unichain: unichainSepolia,
} as const

export type ChainKey = keyof typeof CHAINS

export const CHAIN_IDS = {
  lasna: 5318007,
  base: 84532,
  unichain: 1301,
} as const satisfies Record<ChainKey, number>

export const CHAIN_LABELS: Record<ChainKey, string> = {
  lasna: 'Reactive Lasna',
  base: 'Base Sepolia',
  unichain: 'Unichain Sepolia',
}

export const CHAIN_SHORT: Record<ChainKey, string> = {
  lasna: 'Lasna',
  base: 'Base',
  unichain: 'Unichain',
}

export const CHAIN_ACCENT: Record<ChainKey, string> = {
  lasna: 'text-reactive',
  base: 'text-payment',
  unichain: 'text-asset',
}

/** Canonical explorer URL builders from PRD §9b UI rules. */
export function txUrl(chain: ChainKey, hash?: string | null): string | null {
  if (!hash) return null
  switch (chain) {
    case 'base':
      return `https://sepolia.basescan.org/tx/${hash}`
    case 'lasna':
      return `https://lasna.reactscan.net/tx/${hash}`
    case 'unichain':
      return `https://sepolia.uniscan.xyz/tx/${hash}`
  }
}

export function addressUrl(chain: ChainKey, address?: string | null): string | null {
  if (!address) return null
  switch (chain) {
    case 'base':
      return `https://sepolia.basescan.org/address/${address}`
    case 'lasna':
      return `https://lasna.reactscan.net/address/${address}`
    case 'unichain':
      return `https://sepolia.uniscan.xyz/address/${address}`
  }
}

export const EXPLORER_NAMES: Record<ChainKey, string> = {
  base: 'BaseScan',
  lasna: 'Reactscan',
  unichain: 'Uniscan',
}

export const REPO_URL = 'https://github.com/koredeycode/handshake-reactive'
