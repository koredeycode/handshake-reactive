import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { ClipboardList, LogOut, Plus, Search, Wallet } from 'lucide-react'
import { copyText, truncate } from '../lib/format'
import { useCopyFeedback } from '../lib/proofs'
import { Button, ConvergenceMark, icon } from './ui'

const NAV = [
  { to: '/orders', label: 'Orders', Icon: ClipboardList },
  { to: '/new', label: 'New trade', Icon: Plus },
  { to: '/verify', label: 'Track an order', Icon: Search },
]

function Logo() {
  return (
    <Link to="/orders" className="flex h-[72px] items-center gap-3 border-b border-line px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <ConvergenceMark />
      </span>
      <span>
        <span className="block text-[15px] font-medium text-ink-900">Handshake</span>
        <span className="block text-[11px] text-ink-400">Settlement desk</span>
      </span>
    </Link>
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
    <div className="flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-2 py-1">
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
  const label = pathname.startsWith('/new')
    ? 'New trade'
    : publicView
      ? 'Track an order'
      : pathname.startsWith('/orders/')
        ? 'Order detail'
        : 'Orders'

  return (
    <div className="min-h-screen bg-paper-50 text-ink-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] flex-col border-r border-line bg-paper-0 lg:flex">
        <Logo />
        <nav className="flex-1 px-3 py-6">
          <p className="mb-3 px-2 text-[11px] font-medium text-ink-400">Trade</p>
          <div className="space-y-1">
            {NAV.map(({ to, label: itemLabel, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${
                    isActive
                      ? 'bg-paper-100 font-medium text-accent'
                      : 'text-ink-500 hover:bg-paper-100 hover:text-ink-900'
                  }`
                }
              >
                <Icon {...icon} />
                {itemLabel}
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="border-t border-line px-5 py-4 text-[11px] text-ink-400">Cross-chain OTC settlement</div>
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
              <span className="text-[11px] text-ink-400">Public view</span>
            ) : (
              <WalletControl />
            )}
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-paper-0 px-4 py-2 lg:hidden">
          {NAV.map(({ to, label: itemLabel, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[11px] transition-colors ${
                  isActive ? 'bg-paper-100 font-medium text-accent' : 'text-ink-500'
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
