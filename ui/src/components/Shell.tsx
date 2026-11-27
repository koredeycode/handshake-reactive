import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect, type Connector } from 'wagmi'
import { ArrowUpRight, ChevronDown, ClipboardList, Droplets, House, LogOut, Plus, Search, Wallet, X } from 'lucide-react'
import { useBalanceGroups, useWalletBalances } from '../lib/balances'
import { CHAIN_LABELS } from '../lib/chains'
import { copyText, truncate } from '../lib/format'
import { useCopyFeedback } from '../lib/proofs'
import { Button, ChainMark, ConvergenceMark, icon } from './ui'

const NAV = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/orders', label: 'Trade', Icon: ClipboardList, end: false },
  { to: '/my-orders', label: 'My orders', Icon: Wallet, end: false },
  { to: '/new', label: 'New trade', Icon: Plus, end: false },
  { to: '/verify', label: 'Track an order', Icon: Search, end: false },
]

/** Quiet utility destination — testnet setup, not part of the trading flow. */
const UTILITY_NAV = [{ to: '/faucet', label: 'Faucet', Icon: Droplets }]

function Logo() {
  return (
    <Link to="/" className="flex h-[72px] items-center gap-3 border-b border-line px-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-900 text-white">
        <ConvergenceMark className="h-5 w-5 text-accent" />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-ink-900">Handshake</span>
        <span className="block text-[11px] text-ink-400">Cross-chain OTC</span>
      </span>
    </Link>
  )
}

/** Friendly connector names for the connect modal. */
function connectorLabel(connector: Connector): string {
  if (connector.id === 'walletConnect') return 'WalletConnect'
  if (connector.id === 'injected' || connector.id === 'metaMask') return 'Browser wallet'
  return connector.name || 'Browser wallet'
}

/** Connected wallet: truncated address + chevron. Balances live in the panel. */
function WalletControl() {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { copied, setCopied } = useCopyFeedback()
  const chips = useWalletBalances(isConnected ? address : null)
  const groups = useBalanceGroups()
  const [open, setOpen] = useState(false)
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLDivElement>(null)
  const firstOption = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /**
   * Modal behaviour: focus the first connector on open, keep Tab inside the
   * dialog, close on Escape, lock page scroll and return focus on close.
   * Backdrop clicks close via the overlay's own onClick handler below.
   */
  useEffect(() => {
    if (!connectModalOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstOption.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setConnectModalOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      const restore =
        previouslyFocused && document.contains(previouslyFocused)
          ? previouslyFocused
          : trigger.current?.querySelector('button')
      if (restore && document.contains(restore)) restore.focus()
    }
  }, [connectModalOpen])

  if (!isConnected || !address) {
    const connectLabel = (
      <>
        <span className="hidden sm:inline">{isPending ? 'Connecting' : 'Connect wallet'}</span>
        <span className="sm:hidden">{isPending ? '…' : 'Connect'}</span>
      </>
    )

    return (
      <>
        <div ref={trigger}>
          <Button
            variant="primary"
            size="sm"
            icon={<Wallet {...icon} />}
            aria-haspopup="dialog"
            aria-expanded={connectModalOpen}
            disabled={isPending}
            onClick={() => setConnectModalOpen(true)}
          >
            {connectLabel}
          </Button>
        </div>

        {connectModalOpen &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-[2px]"
              onClick={(event) => {
                if (event.target === event.currentTarget) setConnectModalOpen(false)
              }}
            >
              <div
                ref={dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="wallet-connect-title"
                className="w-full max-w-[380px] rounded-2xl border border-line bg-paper-0 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
              >
                <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <h2 id="wallet-connect-title" className="text-[15px] font-semibold text-ink-900">
                      Connect wallet
                    </h2>
                    <p className="mt-1 text-[11px] text-ink-400">Choose a wallet to continue.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close wallet selection"
                    onClick={() => setConnectModalOpen(false)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-700"
                  >
                    <X {...icon} />
                  </button>
                </div>
                <div className="space-y-2 p-4 sm:p-5">
                  {connectors.length === 0 && (
                    <p className="py-3 text-center text-[12px] text-ink-400">
                      No wallets detected. Install a browser wallet or use WalletConnect.
                    </p>
                  )}
                  {connectors.map((item, index) => (
                    <button
                      key={item.uid}
                      ref={index === 0 ? firstOption : undefined}
                      type="button"
                      onClick={() => {
                        setConnectModalOpen(false)
                        connect({ connector: item })
                      }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-paper-0 px-3 py-2 text-left transition-colors hover:border-ink-400/50 hover:bg-paper-100"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-100 text-ink-500">
                        <Wallet {...icon} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-700">{connectorLabel(item)}</span>
                      <ArrowUpRight {...icon} className="shrink-0 text-ink-400" />
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )}
      </>
    )
  }

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-paper-0 px-2.5 py-1.5 transition-colors hover:bg-paper-100"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="tnum font-mono text-[11px] text-ink-700">
          {copied === 'address' ? 'Copied' : truncate(address, 6, 4)}
        </span>
        <ChevronDown {...icon} className={`text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Wallet balances"
          className="absolute right-0 top-full z-40 mt-2 w-[272px] rounded-2xl border border-line bg-paper-0 p-3 shadow-[0_18px_45px_rgba(24,24,27,0.12)]"
        >
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="text-[11px] font-medium text-ink-700">Wallet balances</span>
            <span className="text-[10px] text-ink-400">Testnets</span>
          </div>
          <div className="space-y-3 py-3">
            {groups.map(({ chain, keys }) => (
              <div key={chain}>
                <div className="flex items-center gap-2 text-[11px] font-medium text-ink-700">
                  <ChainMark chain={chain} />
                  {CHAIN_LABELS[chain]}
                </div>
                <div className="mt-1.5 space-y-1 pl-6">
                  {chips
                    .filter((chip) => keys.includes(chip.key))
                    .map((chip) => (
                      <div key={chip.key} title={chip.title} className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="text-ink-500">{chip.asset}</span>
                        <span className="tnum font-mono text-ink-900">{chip.label}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line pt-2.5">
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(address)
                setCopied(ok ? 'address' : 'failed')
              }}
              className="inline-flex min-h-10 items-center px-1 text-[12px] text-ink-500 transition-colors hover:text-accent"
            >
              {copied === 'address' ? 'Copied' : 'Copy address'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                disconnect()
              }}
              className="inline-flex min-h-10 items-center gap-1 px-1 text-[12px] text-ink-500 transition-colors hover:text-bad"
            >
              <LogOut {...icon} />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const publicView = pathname.startsWith('/verify')
  const internal = pathname.startsWith('/dev')
  const label = internal
    ? 'Internal diagnostics'
    : pathname.startsWith('/faucet')
      ? 'Faucet'
      : pathname.startsWith('/new')
      ? 'New trade'
      : publicView
        ? 'Track an order'
        : pathname.startsWith('/my-orders')
          ? 'My orders'
          : pathname.startsWith('/orders/')
            ? 'Order detail'
            : pathname === '/'
              ? 'Home'
              : 'Trade'

  return (
    <div className="min-h-screen bg-paper-50 text-ink-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] flex-col border-r border-line bg-paper-0 lg:flex">
        <Logo />
        <nav className="flex-1 px-3 py-6">
          <p className="mb-3 px-2 text-[11px] text-ink-400">Trade</p>
          <div className="space-y-1">
            {NAV.map(({ to, label: itemLabel, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-accent-soft font-medium text-accent-ink'
                      : 'text-ink-500 hover:bg-paper-100 hover:text-ink-900'
                  }`
                }
              >
                <Icon {...icon} />
                {itemLabel}
              </NavLink>
            ))}
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 px-2 text-[11px] text-ink-400">Testnet</p>
            <div className="space-y-1">
              {UTILITY_NAV.map(({ to, label: itemLabel, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors ${
                      isActive ? 'bg-paper-100 font-medium text-ink-900' : 'text-ink-500 hover:bg-paper-100'
                    }`
                  }
                >
                  <Icon {...icon} />
                  {itemLabel}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
        <div className="border-t border-line px-5 py-4 text-[11px] text-ink-400">
          Three testnets, one decision, two releases
        </div>
      </aside>

      <div className="lg:pl-[256px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line bg-paper-50/95 px-4 backdrop-blur-sm sm:px-6 lg:px-10">
          <Link
            to="/"
            aria-label="Home"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-900 text-white sm:hidden"
          >
            <ConvergenceMark className="h-4 w-4 text-accent" />
          </Link>
          <div className="hidden min-w-0 items-center gap-2 text-[13px] sm:flex">
            <span className="text-ink-400">Handshake</span>
            <span className="text-ink-400">/</span>
            <span className="truncate font-medium text-ink-900">{label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {publicView ? (
              <span className="rounded-full border border-line bg-paper-0 px-2 py-0.5 text-[10px] text-ink-500 sm:px-2.5 sm:py-1 sm:text-[11px]">
                Public view
              </span>
            ) : internal ? (
              <span className="rounded-full border border-bad/25 bg-bad-soft px-2 py-0.5 text-[10px] text-bad sm:px-2.5 sm:py-1 sm:text-[11px]">
                Internal
              </span>
            ) : (
              <WalletControl />
            )}
          </div>
        </header>

        <nav
          aria-label="Primary"
          className="grid grid-cols-3 gap-1 border-b border-line bg-paper-0 px-3 py-2 sm:grid-cols-6 lg:hidden"
        >
          {NAV.map(({ to, label: itemLabel, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-center text-[10px] leading-tight transition-colors ${
                  isActive ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-500'
                }`
              }
            >
              <Icon {...icon} />
              <span>{itemLabel}</span>
            </NavLink>
          ))}
          {UTILITY_NAV.map(({ to, label: itemLabel, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-center text-[10px] leading-tight transition-colors ${
                  isActive ? 'bg-paper-100 font-medium text-ink-900' : 'text-ink-500'
                }`
              }
            >
              <Icon {...icon} />
              <span>{itemLabel}</span>
            </NavLink>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-[1440px] px-6 py-8 lg:px-10">
          <div className="page-enter">{children}</div>
        </main>
      </div>
    </div>
  )
}
