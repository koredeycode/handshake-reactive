import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { ClipboardList, Droplets, LogOut, Plus, Search, Wallet } from 'lucide-react'
import { useWalletBalances } from '../lib/balances'
import { copyText, truncate } from '../lib/format'
import { useCopyFeedback } from '../lib/proofs'
import { Button, ChainMark, ConvergenceMark, icon } from './ui'

const NAV = [
  { to: '/orders', label: 'Trade', Icon: ClipboardList },
  { to: '/new', label: 'New trade', Icon: Plus },
  { to: '/verify', label: 'Track an order', Icon: Search },
]

/** Quiet utility destination — testnet setup, not part of the trading flow. */
const UTILITY_NAV = [{ to: '/faucet', label: 'Faucet', Icon: Droplets }]

function Logo() {
  return (
    <Link to="/orders" className="flex h-[72px] items-center gap-3 border-b border-line px-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-900 text-white">
        <ConvergenceMark />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-ink-900">Handshake</span>
        <span className="block text-[11px] text-ink-400">Cross-chain OTC</span>
      </span>
    </Link>
  )
}

/** Compact per-chain chips. Reads are chain-scoped, so no wrong-chain banner. */
function WalletBalances() {
  const { address, isConnected } = useAccount()
  const chips = useWalletBalances(isConnected ? address : null)

  if (!isConnected || !address) return null
  return (
    <div
      aria-label="Wallet balances"
      className="hidden max-w-[54vw] items-center gap-1.5 overflow-x-auto sm:flex"
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={chip.title}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-paper-0 px-2 py-1 text-[11px] text-ink-400"
        >
          <ChainMark chain={chip.chain} className="h-3 w-3" />
          <span className="tnum font-mono text-ink-700">{chip.label}</span>
        </span>
      ))}
    </div>
  )
}

function WalletControl() {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { copied, setCopied } = useCopyFeedback()
  const connector = connectors[0]

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
    <div className="flex items-center gap-2 rounded-xl border border-line bg-paper-0 px-2.5 py-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <button
        type="button"
        title="Copy address"
        onClick={async () => {
          const ok = await copyText(address)
          setCopied(ok ? 'address' : 'failed')
        }}
        className="tnum font-mono text-[11px] text-ink-700 transition-colors hover:text-accent"
      >
        {copied === 'address' ? 'Copied' : truncate(address, 6, 4)}
      </button>
      <button
        type="button"
        title="Disconnect"
        onClick={() => disconnect()}
        className="text-ink-400 transition-colors hover:text-bad"
      >
        <LogOut {...icon} />
      </button>
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
        : pathname.startsWith('/orders/')
          ? 'Order detail'
          : 'Trade'

  return (
    <div className="min-h-screen bg-paper-50 text-ink-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] flex-col border-r border-line bg-paper-0 lg:flex">
        <Logo />
        <nav className="flex-1 px-3 py-6">
          <p className="mb-3 px-2 text-[11px] text-ink-400">Trade</p>
          <div className="space-y-1">
            {NAV.map(({ to, label: itemLabel, Icon }) => (
              <NavLink
                key={to}
                to={to}
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
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-ink-400">Handshake</span>
            <span className="text-ink-400">/</span>
            <span className="font-medium text-ink-900">{label}</span>
          </div>
          <div className="flex items-center gap-3">
            {publicView ? (
              <span className="rounded-full border border-line bg-paper-0 px-2.5 py-1 text-[11px] text-ink-500">
                Public view
              </span>
            ) : internal ? (
              <span className="rounded-full border border-bad/25 bg-bad-soft px-2.5 py-1 text-[11px] text-bad">
                Internal
              </span>
            ) : (
              <>
                <WalletBalances />
                <WalletControl />
              </>
            )}
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-paper-0 px-4 py-2 lg:hidden">
          {NAV.map(({ to, label: itemLabel, Icon }) => (
            <NavLink
              key={to}
              to={to}
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
