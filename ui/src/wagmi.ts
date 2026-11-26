import { createConfig, fallback, http, injected } from 'wagmi'
import { baseSepolia } from 'viem/chains'
import { lasna, unichainSepolia } from './lib/chains'

export const wagmiConfig = createConfig({
  chains: [lasna, baseSepolia, unichainSepolia],
  // Lasna has no Multicall3 at viem's canonical address. Automatic request
  // batching falls back to per-call eth_call so reads never require it.
  batch: { multicall: false },
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: {
    [lasna.id]: http('https://lasna-rpc.rnk.dev/', { timeout: 15_000 }),
    [baseSepolia.id]: fallback([
      http('https://sepolia.base.org', { timeout: 15_000 }),
      http('https://base-sepolia-rpc.publicnode.com', { timeout: 15_000 }),
    ]),
    [unichainSepolia.id]: fallback([
      http('https://sepolia.unichain.org', { timeout: 15_000 }),
      http('https://unichain-sepolia-rpc.publicnode.com', { timeout: 15_000 }),
    ]),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
