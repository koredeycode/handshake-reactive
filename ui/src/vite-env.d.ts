/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public read API + SSE origin. Defaults to http://localhost:8080 for local dev. */
  readonly VITE_API_URL?: string
  readonly VITE_RC_ADDRESS?: string
  readonly VITE_SYSTEM_ADDRESS?: string
  readonly VITE_LEGACY_SYSTEM_ADDRESS?: string
  /** Callback proxies per settlement chain. */
  readonly VITE_BASE_PROXY?: string
  readonly VITE_UNICHAIN_PROXY?: string
  readonly VITE_SEPOLIA_PROXY?: string
  /** Scan anchors per chain. */
  readonly VITE_LASNA_FROM_BLOCK?: string
  readonly VITE_BASE_FROM_BLOCK?: string
  readonly VITE_UNICHAIN_FROM_BLOCK?: string
  readonly VITE_SEPOLIA_FROM_BLOCK?: string
  readonly VITE_LOOKBACK_BLOCKS?: string
  /** Sepolia token addresses filled from the deploy manifest. */
  readonly VITE_SEPOLIA_TUSD_ADDRESS?: string
  readonly VITE_SEPOLIA_TASSET_ADDRESS?: string
  /** Optional private/primary RPC URLs; they become the first fallback hop. */
  readonly VITE_BASE_RPC?: string
  readonly VITE_UNICHAIN_RPC?: string
  readonly VITE_SEPOLIA_RPC?: string
  readonly VITE_LASNA_RPC?: string
  /** Enables the hidden /dev diagnostics route in production builds. */
  readonly VITE_DEV_TOOLS?: string
  /**
   * FUTURE-ONLY cutover flag for the permissionless `expire` action. Set to 1
   * ONLY after the Cron100 RC redeploy; the UI also refuses while the configured
   * RC is the known live address.
   */
  readonly VITE_EXPIRE_ENABLED?: string
  /** Optional WalletConnect Cloud project id; enables the WalletConnect connector. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
