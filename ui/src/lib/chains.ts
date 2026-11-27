import { defineChain } from 'viem'
import { baseSepolia, sepolia as viemSepolia } from 'viem/chains'

/**
 * Reactive Lasna and Unichain Sepolia are not in viem's chain list (or are
 * named differently), so we define them explicitly. Ethereum Sepolia is in
 * viem, but we redefine it with testnet-safe public RPC fallbacks.
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
  // Canonical Multicall3 is deployed here; viem only batches reads when the
  // chain declares it. Verified via eth_getCode at this address.
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 0 },
  },
  blockExplorers: {
    default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz/' },
  },
  testnet: true,
})

export const ethereumSepolia = defineChain({
  ...viemSepolia,
  rpcUrls: {
    default: { http: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'] },
    public: { http: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'] },
  },
  // Multicall3 is deployed at the canonical address on Ethereum Sepolia.
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 0 },
  },
  testnet: true,
})

/** The three EVM settlement chains plus the reactive chain that arbitrates. */
export const CHAINS = {
  lasna,
  base: baseSepolia,
  unichain: unichainSepolia,
  sepolia: ethereumSepolia,
} as const

export type ChainKey = keyof typeof CHAINS
/** The three chains that can hold a leg. Lasna arbitrates but never holds funds. */
export type TradingChainKey = Exclude<ChainKey, 'lasna'>

export const TRADING_CHAIN_KEYS: readonly TradingChainKey[] = ['base', 'unichain', 'sepolia']

export const CHAIN_IDS = {
  lasna: 5318007,
  base: 84532,
  unichain: 1301,
  sepolia: 11155111,
} as const satisfies Record<ChainKey, number>

export const CHAIN_LABELS: Record<ChainKey, string> = {
  lasna: 'Reactive Lasna',
  base: 'Base Sepolia',
  unichain: 'Unichain Sepolia',
  sepolia: 'Ethereum Sepolia',
}

export const CHAIN_SHORT_LABELS: Record<ChainKey, string> = {
  lasna: 'Lasna',
  base: 'Base',
  unichain: 'Unichain',
  sepolia: 'Sepolia',
}

export const CHAIN_ACCENT: Record<ChainKey, string> = {
  lasna: 'text-reactive',
  base: 'text-payment',
  unichain: 'text-asset',
  sepolia: 'text-reactive',
}

/** Local, official chain marks — bundled under public/chains, never a CDN at runtime. */
export const CHAIN_LOGO: Record<ChainKey, string> = {
  base: '/chains/base.svg',
  lasna: '/chains/lasna.svg',
  unichain: '/chains/unichain.svg',
  sepolia: '/chains/sepolia.svg',
}

const CHAIN_KEY_BY_ID: Record<number, ChainKey> = Object.fromEntries(
  Object.entries(CHAIN_IDS).map(([key, id]) => [id, key as ChainKey]),
)

/** Chain keys always come from a chain id, never from a direction label. */
export function chainKeyFromId(chainId: number | bigint): ChainKey | null {
  return CHAIN_KEY_BY_ID[Number(chainId)] ?? null
}

export function tradingChainKeyFromId(chainId: number | bigint): TradingChainKey | null {
  const key = chainKeyFromId(chainId)
  return key && key !== 'lasna' ? key : null
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
    case 'sepolia':
      return `https://sepolia.etherscan.io/tx/${hash}`
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
    case 'sepolia':
      return `https://sepolia.etherscan.io/address/${address}`
  }
}

export const EXPLORER_NAMES: Record<ChainKey, string> = {
  base: 'BaseScan',
  lasna: 'Reactscan',
  unichain: 'Uniscan',
  sepolia: 'Etherscan',
}

/** Sepolia-specific gas sources; the Superchain faucet does not fund Sepolia. */
export const GAS_LINKS: Record<TradingChainKey, Array<{ label: string; href: string }>> = {
  base: [
    { label: 'Alchemy', href: 'https://www.alchemy.com/faucets/base-sepolia' },
    { label: 'Coinbase', href: 'https://coinbase.com/faucets/base-sepolia' },
    { label: 'Superchain', href: 'https://app.optimism.io/faucet' },
  ],
  unichain: [
    { label: 'Alchemy', href: 'https://www.alchemy.com/faucets/unichain-sepolia' },
    { label: 'ZalalenA', href: 'https://faucet.zalalena.com/unichain' },
    { label: 'Superchain', href: 'https://app.optimism.io/faucet' },
  ],
  sepolia: [
    { label: 'Alchemy Sepolia', href: 'https://www.alchemy.com/faucets/ethereum-sepolia' },
    { label: 'Coinbase Sepolia', href: 'https://coinbase.com/faucets/ethereum-sepolia' },
    { label: 'PoW Filter', href: 'https://sepolia-faucet.pk910.de/' },
  ],
}

export const REPO_URL = 'https://github.com/koredeycode/handshake-reactive'
