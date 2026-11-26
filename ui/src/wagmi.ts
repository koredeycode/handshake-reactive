import { createConfig, fallback, http, injected } from 'wagmi'
import { shouldThrow as viemShouldThrow } from 'viem'
import { baseSepolia } from 'viem/chains'
import { lasna, unichainSepolia } from './lib/chains'

/**
 * Public RPCs are shared and rate-limited. Key points (see ui/RPC-AUDIT.md):
 * - `retryCount: 0` on BOTH the fallback and each inner http transport. viem's
 *   default (3) re-walks the whole list on -32005 / HTTP 429 and multiplies
 *   rate-limit errors instead of healing them.
 * - `rank: false` (explicit): viem's ranker would ping every endpoint with
 *   `net_listening` every ~4s, adding permanent background traffic.
 * - `shouldThrow` fails over immediately for per-endpoint quirks (range caps,
 *   rate limits) rather than hammering the same URL again.
 * - Order is priority, not latency: the most reliable endpoint is first.
 */
function isPerEndpointRpcError(error: Error & { code?: number | string; status?: number }): boolean {
  const message = error.message ?? ''
  return (
    error.code === -32614 || // e.g. "eth_getLogs is limited to a 200 range"
    error.code === -32005 || // rate limit exceeded
    error.code === -32602 || // e.g. "block range greater than 1000 max"
    error.status === 429 ||
    /rate limit|too many requests|limited to a \d+ range|block range greater|range too large/i.test(message)
  )
}

function failoverFast(error: Error): boolean {
  if (isPerEndpointRpcError(error as Error & { code?: number; status?: number })) return false
  // Keep viem's behaviour for wallet/user-rejected and execution-reverted calls:
  // those must not be replayed on a different endpoint.
  return viemShouldThrow(error)
}

const RPC_TIMEOUT = 12_000

/** VITE_*_RPC lets a deployment use a private provider URL as the first hop. */
function urls(override: string | undefined, defaults: readonly string[]): string[] {
  return override ? [override, ...defaults] : [...defaults]
}

export const wagmiConfig = createConfig({
  chains: [lasna, baseSepolia, unichainSepolia],
  // Multicall3 is deployed on Base Sepolia and Unichain Sepolia (verified at
  // 0xcA11...CA11); Reactive Lasna has none. Chain-keyed batch config is
  // resolved per client by @wagmi/core/createConfig, so the order board's
  // parallel readContract calls collapse into one eth_call on the two EVM
  // chains while Lasna keeps plain eth_calls.
  batch: {
    [lasna.id]: { multicall: false },
    [baseSepolia.id]: { multicall: true },
    [unichainSepolia.id]: { multicall: true },
  },
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: {
    // publicnode is first: sepolia.base.org intermittently enforces a 200-block
    // eth_getLogs cap and -32005 rate limits. drpc is kept as a last resort.
    [baseSepolia.id]: fallback(
      urls(import.meta.env.VITE_BASE_RPC, [
        'https://base-sepolia-rpc.publicnode.com',
        'https://sepolia.base.org',
        'https://sepolia.drpc.org',
      ]).map((url) => http(url, { timeout: RPC_TIMEOUT, retryCount: 0 })),
      { rank: false, retryCount: 0, shouldThrow: failoverFast },
    ),
    [unichainSepolia.id]: fallback(
      urls(import.meta.env.VITE_UNICHAIN_RPC, [
        'https://sepolia.unichain.org',
        'https://unichain-sepolia-rpc.publicnode.com',
        'https://unichain-sepolia.drpc.org',
      ]).map((url) => http(url, { timeout: RPC_TIMEOUT, retryCount: 0 })),
      { rank: false, retryCount: 0, shouldThrow: failoverFast },
    ),
    // Lasna has only one working public endpoint. lasna.drpc.org does not
    // respond from this environment, so adding it would only add dead time.
    [lasna.id]: fallback(
      urls(import.meta.env.VITE_LASNA_RPC, ['https://lasna-rpc.rnk.dev/']).map((url) =>
        http(url, { timeout: RPC_TIMEOUT, retryCount: 0 }),
      ),
      { rank: false, retryCount: 0, shouldThrow: failoverFast },
    ),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
