import { walletConnect } from '@wagmi/connectors'
import { createConfig, fallback, http, injected, type CreateConnectorFn } from 'wagmi'
import { shouldThrow as viemShouldThrow } from 'viem'
import { baseSepolia } from 'viem/chains'
import { ethereumSepolia, lasna, unichainSepolia } from './lib/chains'

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

/**
 * Injected stays first so browser extensions and desktop wallets keep the
 * existing one-click path. Many mobile in-app browsers (including Zerion's)
 * expose no `window.ethereum`, so WalletConnect is added only when a free
 * WalletConnect Cloud project id is configured at build time. Without the
 * env var the bundle builds and behaves exactly as before.
 */
function buildConnectors(): CreateConnectorFn[] {
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })]
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
  if (projectId) {
    connectors.push(
      walletConnect({
        projectId,
        showQrModal: true,
        // @wagmi/connectors v6 takes the supported chains from wagmiConfig
        // below (lasna, baseSepolia, unichainSepolia) instead of a `chains`
        // option, so the session always matches the configured app chains.
      }),
    )
  }
  return connectors
}

/** VITE_*_RPC lets a deployment use a private provider URL as the first hop. */
function urls(override: string | undefined, defaults: readonly string[]): string[] {
  return override ? [override, ...defaults] : [...defaults]
}

/** Read-only probe used by the shell to explain "no wallets detected" on mobile. */
export function hasInjectedWallet(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as Window & { ethereum?: unknown }).ethereum)
}

export const wagmiConfig = createConfig({
  chains: [lasna, baseSepolia, unichainSepolia, ethereumSepolia],
  // Multicall3 is deployed on all three EVM settlement chains at the
  // canonical 0xcA11...CA11 address; Reactive Lasna has none. Chain-keyed
  // batch config is resolved per client, so catalog balance reads collapse
  // into one eth_call where possible while Lasna keeps plain eth_calls.
  batch: {
    [lasna.id]: { multicall: false },
    [baseSepolia.id]: { multicall: true },
    [unichainSepolia.id]: { multicall: true },
    [ethereumSepolia.id]: { multicall: true },
  },
  connectors: buildConnectors(),
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
    [ethereumSepolia.id]: fallback(
      urls(import.meta.env.VITE_SEPOLIA_RPC, [
        'https://ethereum-sepolia-rpc.publicnode.com',
        'https://rpc.sepolia.org',
        'https://sepolia.drpc.org',
      ]).map((url) => http(url, { timeout: RPC_TIMEOUT, retryCount: 0 })),
      { rank: false, retryCount: 0, shouldThrow: failoverFast },
    ),
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
