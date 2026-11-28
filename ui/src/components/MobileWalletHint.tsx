import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { hasInjectedWallet } from '../wagmi'
import { Notice } from './ui'

const WALLET_ROUTES = ['/', '/orders', '/new', '/my-orders', '/faucet']

/** In-app mobile browsers have no injected provider and no WalletConnect project id here. */
function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
}

/**
 * Rendered by App inside Shell (Shell itself is untouched). It only appears on
 * write-capable routes, for disconnected mobile visitors with no wallet app.
 * Browsing and tracking stay usable without a wallet, so this is a hint, not a gate.
 */
export default function MobileWalletHint() {
  const { pathname } = useLocation()
  const { isConnected } = useAccount()
  // The injected connector is always registered, so `connectors.length` can
  // never express "no usable wallet": gate on the actual provider and on
  // whether WalletConnect was configured for this build instead.
  const walletConnectEnabled = !!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    setMobile(isMobileBrowser())
  }, [])

  const relevant = WALLET_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  if (!mobile || isConnected || hasInjectedWallet() || walletConnectEnabled || !relevant) return null

  return (
    <Notice title="Using a phone or in-app browser?" className="mb-6">
      No wallet app was detected here. Open Handshake in a wallet browser (for example MetaMask), or use WalletConnect
      from a wallet app that supports it. You can still browse orders and track trades without a wallet.
    </Notice>
  )
}
