import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { ChevronDown, ClipboardList, Droplets, House, LogOut, Plus, Search, Wallet } from 'lucide-react'
import { useWalletBalances } from '../lib/balances'
import { CHAIN_LABELS } from '../lib/chains'
import { copyText, truncate } from '../lib/format'
import { useMarket } from '../lib/markets'
import { useCopyFeedback } from '../lib/proofs'
import { Button, ChainMark, ConvergenceMark, icon } from './ui'
import MarketSelector from './MarketSelector'
import type { ChainKey } from '../lib/chains'

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

function useBalanceGroups(): Array<{ chain: ChainKey; keys: string[] }> {
  const { chainKeyFor } = useMarket()
  return useMemo(
    () => [
      { chain: chainKeyFor('payment'), keys: ['payment-native', 'payment-token'] },
      { chain: chainKeyFor('asset'), keys: ['asset-native', 'asset-token'] },
      { chain: 'lasna' as ChainKey, keys: ['lasna-native'] },
    ],
    [chainKeyFor],
  )
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
  const root = useRef<HTMLDivElement>(null)
  const connector = connectors[0]

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

  if (!isConnected || !address) {
    return (
      <Button
        variant="primary"
        size="sm"
        icon={<Wallet {...icon} />}
        disabled={!connector || isPending}
        onClick={() => connector && connect({ connector })}
      >
        {isPending ? 'Connecting' : 'Connect wallet'}
      </Button>
    )
  }

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-xl border border-line bg-paper-0 px-2.5 py-1.5 transition-colors hover:bg-paper-100"
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
              className="text-[11px] text-ink-500 transition-colors hover:text-accent"
            >
              {copied === 'address' ? 'Copied' : 'Copy address'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                disconnect()
              }}
              className="inline-flex items-center gap-1 text-[11px] text-ink-500 transition-colors hover:text-bad"
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
          Two chains in, one decision, two out
        </div>
      </aside>

      <div className="lg:pl-[256px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line bg-paper-50/95 px-6 backdrop-blur-sm lg:px-10">
          <div className="hidden min-w-0 items-center gap-2 text-[13px] sm:flex">
            <span className="text-ink-400">Handshake</span>
            <span className="text-ink-400">/</span>
            <span className="truncate font-medium text-ink-900">{label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <MarketSelector />
            {publicView ? (
              <span className="rounded-full border border-line bg-paper-0 px-2.5 py-1 text-[11px] text-ink-500">
                Public view
              </span>
            ) : internal ? (
              <span className="rounded-full border border-bad/25 bg-bad-soft px-2.5 py-1 text-[11px] text-bad">
                Internal
              </span>
            ) : (
              <WalletControl />
            )}
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-paper-0 px-4 py-2 lg:hidden">
          {NAV.map(({ to, label: itemLabel, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[11px] transition-colors ${
                  isActive ? 'bg-accent-soft font-medium text-accent-ink' : 'text-ink-500'
                }`
              }
            >
              <Icon {...icon} />
              {itemLabel}
            </NavLink>
          ))}
          {UTILITY_NAV.map(({ to, label: itemLabel, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[11px] transition-colors ${
                  isActive ? 'bg-paper-100 font-medium text-ink-900' : 'text-ink-500'
                }`
              }
            >
              <Icon {...icon} />
              {itemLabel}
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
