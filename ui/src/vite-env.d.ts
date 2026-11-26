/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RC_ADDRESS?: string
  readonly VITE_SYSTEM_ADDRESS?: string
  readonly VITE_LEGACY_SYSTEM_ADDRESS?: string
  readonly VITE_PAYMENT_ESCROW?: string
  readonly VITE_PAYMENT_TOKEN?: string
  readonly VITE_BASE_PROXY?: string
  readonly VITE_ASSET_ESCROW?: string
  readonly VITE_ASSET_TOKEN?: string
  readonly VITE_UNICHAIN_PROXY?: string
  readonly VITE_LASNA_FROM_BLOCK?: string
  readonly VITE_BASE_FROM_BLOCK?: string
  readonly VITE_UNICHAIN_FROM_BLOCK?: string
  readonly VITE_LOOKBACK_BLOCKS?: string
  /** Optional private/primary RPC URLs; they become the first fallback hop. */
  readonly VITE_BASE_RPC?: string
  readonly VITE_UNICHAIN_RPC?: string
  readonly VITE_LASNA_RPC?: string
  /** Enables the hidden /dev diagnostics route in production builds. */
  readonly VITE_DEV_TOOLS?: string
  /** Optional WalletConnect Cloud project id; enables the WalletConnect connector. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
