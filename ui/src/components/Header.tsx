import { NavLink, Link } from 'react-router-dom'
import { useAccount, useChainId, useConnect, useDisconnect } from 'wagmi'
import { CHAIN_IDS, CHAIN_LABELS, CHAIN_SHORT } from '../lib/chains'
import { useConfig } from '../lib/config'
import { copyText, formatNative, truncate } from '../lib/format'
import { useHealth, useNativeBalances } from '../lib/queries'
import { useCopyFeedback } from '../lib/proofs'
import { CodeBlock } from './ui'

const NAV = [
  { to: '/orders', label: 'Orders' },
  { to: '/verify', label: 'Verify' },
  { to: '/latency', label: 'Latency' },
  { to: '/how-it-works', label: 'How it works' },
]

const THRESHOLDS: Record<string, bigint> = {
  lasna: 50_000_000_000_000_000n, // 0.05 lREACT
  base: 5_000_000_000_000_000n, // 0.005 ETH
  unichain: 5_000_000_000_000_000n,
}

function NetworkChip({
  chain,
  chainId,
  symbol,
  balance,
  configured,
}: {
  chain: 'lasna' | 'base' | 'unichain'
  chainId: number
  symbol: string
  balance?: bigint
  configured: boolean
}) {
  const low = balance !== undefined && balance < (THRESHOLDS[chain] ?? 0n)
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-ink-850/70 px-2.5 py-1.5"
      title={`${CHAIN_LABELS[chain]} · chain ${chainId}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${!configured || low ? 'bg-bad shadow-[0_0_8px_rgba(248,113,113,0.6)]' : 'bg-good shadow-[0_0_8px_rgba(52,211,153,0.45)]'}`}
      />
      <span className="text-[11px] font-medium text-slate-300">{CHAIN_SHORT[chain]}</span>
      <span className="font-mono text-[10px] text-slate-500">{chainId}</span>
      <span className="font-mono text-[11px] text-slate-200">
        {balance === undefined ? '—' : formatNative(balance, symbol)}
      </span>
    </div>
  )
}

function DebtBanner() {
  const health = useHealth()
  const config = useConfig()
  const indebted = (health.data ?? []).filter((row) => row.debt !== undefined && row.debt > 0n)
  if (indebted.length === 0) return null
  const commands = [
    `# Lasna RC debt: ${indebted.find((r) => r.key === 'lasna')?.debt?.toString() ?? '—'} wei`,
    `cast send 0x8888888888888888888888888888888888888888 "depositTo(address)" ${config.reactive.reactiveContract} --rpc-url https://lasna-rpc.rnk.dev/ --private-key $PK --value 1ether`,
    `cast send ${config.base.callbackProxy} "depositTo(address)" ${config.base.paymentEscrow} --rpc-url https://sepolia.base.org --private-key $PK --value 0.02ether`,
    `cast send ${config.unichain.callbackProxy} "depositTo(address)" ${config.unichain.assetEscrow} --rpc-url https://sepolia.unichain.org --private-key $PK --value 0.02ether`,
  ].join('\n')
  return (
    <div className="border-b border-red-500/30 bg-red-500/[0.08] px-4 py-3">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-red-200">
            Execution paused — top up with depositTo before demoing
          </p>
          <p className="mt-0.5 text-[11px] text-red-200/70">
            Debt on {indebted.map((r) => CHAIN_LABELS[r.key]).join(', ')}. Reactive transactions and callbacks are not delivered while debt &gt; 0. Verification reads still work.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyText(commands)}
          className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-100 transition hover:bg-red-500/20"
        >
          Copy cast commands
        </button>
      </div>
      <div className="mx-auto mt-2 max-w-7xl">
        <details className="text-[11px] text-red-200/70">
          <summary className="cursor-pointer">show commands</summary>
          <div className="mt-2"><CodeBlock>{commands}</CodeBlock></div>
        </details>
      </div>
    </div>
  )
}

export default function Header() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const balances = useNativeBalances(address)
  const config = useConfig()
  const { copied, setCopied } = useCopyFeedback()
  const connector = connectors[0]

  const activeChain = Object.entries(CHAIN_IDS).find(([, id]) => id === chainId)?.[0]

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
          <Link to="/orders" className="group flex items-center gap-2.5">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-reactive via-payment to-asset text-[13px] font-black text-ink-950 shadow-glow">
              H
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight text-slate-50">Handshake</span>
              <span className="block text-[10px] uppercase tracking-widest text-slate-500">settlement console</span>
            </span>
          </Link>

          <nav className="order-3 flex w-full items-center gap-1 md:order-none md:w-auto md:flex-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    isActive
                      ? 'bg-white/[0.08] text-slate-50 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="hidden items-center gap-2 lg:flex">
              <NetworkChip
                chain="lasna"
                chainId={CHAIN_IDS.lasna}
                symbol="lREACT"
                balance={balances.lasna?.value}
                configured={!!config.reactive.reactiveContract}
              />
              <NetworkChip
                chain="base"
                chainId={CHAIN_IDS.base}
                symbol="ETH"
                balance={balances.base?.value}
                configured={!!config.base.paymentEscrow}
              />
              <NetworkChip
                chain="unichain"
                chainId={CHAIN_IDS.unichain}
                symbol="ETH"
                balance={balances.unichain?.value}
                configured={!!config.unichain.assetEscrow}
              />
            </div>

            {isConnected && address ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-ink-850/80 px-2.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                <button
                  type="button"
                  title="Copy address"
                  onClick={async () => {
                    const ok = await copyText(address)
                    setCopied(ok ? 'address' : 'failed')
                  }}
                  className="font-mono text-[11px] text-slate-200 hover:text-white"
                >
                  {copied === 'address' ? 'Copied!' : truncate(address, 6, 4)}
                </button>
                <span className="ml-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-400">
                  {activeChain ?? `chain ${chainId}`}
                </span>
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="ml-1 text-[10px] text-slate-500 hover:text-red-300"
                  title="Disconnect"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!connector || isPending}
                onClick={() => connector && connect({ connector })}
                className="rounded-lg bg-gradient-to-r from-reactive to-payment px-3.5 py-2 text-xs font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {isPending ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </div>
        </div>
        <DebtBanner />
      </header>
      {!isConnected && (
        <div className="border-b border-white/[0.04] bg-ink-900/60 px-4 py-1.5 text-center text-[11px] text-slate-500">
          Read-only mode — all chain data is visible; wallet actions require an injected wallet.
        </div>
      )}
    </>
  )
}
