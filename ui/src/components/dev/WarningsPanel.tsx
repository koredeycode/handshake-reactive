import { useAccount } from 'wagmi'
import { CHAIN_LABELS } from '../../lib/chains'

import { formatNative } from '../../lib/format'
import { useMarket, useMarketConfig } from '../../lib/markets'
import { useHealth, useNativeBalances } from '../../lib/queries'
import { useTradeTicket } from '../../lib/tradeTicket'
import { useVenues } from '../../lib/venues'
import { AlertCircle, Wallet } from 'lucide-react'
import { Metric, Panel, Spinner, icon } from '../ui'

const CAVEATS = [
  {
    title: 'Eventually atomic, not single-transaction atomic',
    body: 'One leg can release while the second callback is still in flight. Both callbacks are requested from one reactive transaction, and each escrow is independently correct, but this is not bridge-grade atomicity.',
  },
  {
    title: 'Cron cost and ~2 min granularity (after Cron100 cutover)',
    body: 'After the Cron100 redeploy, the deadline sweep runs on Cron100. Expired orders would settle within roughly one tick (~2 min), not at the exact second.',
  },
  {
    title: 'Cancellation before matching',
    body: 'A buyer can cancel an open, unmatched order before its deadline. Abandoned orders refund automatically once they expire.',
  },
  {
    title: 'Pre-flight terms hash',
    body: 'The UI computes the expected terms hash from getOrder(id) before enabling a lock. Confirm the canonical encoding with the deployed contracts before signing.',
  },
]

export default function WarningsPanel() {
  const config = useMarketConfig()
  const { chainKeyFor } = useMarket()
  const venues = useVenues()
  const health = useHealth()
  const { address } = useAccount()
  const balances = useNativeBalances(address)
  const ticket = useTradeTicket()
  const paymentChain = ticket.chainFor('payment')
  const assetChain = ticket.chainFor('asset')
  const paymentToken = ticket.tokenFor('payment')
  const assetToken = ticket.tokenFor('asset')

  const indebted = (health.data ?? []).filter((row) => row.debt !== undefined && row.debt > 0n)
  const tokenSymbols = [`${paymentToken?.name ?? '—'} (${paymentToken?.symbol ?? '—'})`, `${assetToken?.name ?? '—'} (${assetToken?.symbol ?? '—'})`]
  const chainLabelFor = (key: 'lasna' | 'payment' | 'asset') =>
    key === 'lasna' ? CHAIN_LABELS.lasna : CHAIN_LABELS[chainKeyFor(key)]

  return (
    <div className="space-y-6">
      <Panel
        title="Execution warnings"
        subtitle="Live debt reads and protocol caveats — internal use only"
        action={
          <span className="flex items-center gap-2 text-[11px] text-ink-400">
            {health.isFetching && <Spinner />}
            {health.dataUpdatedAt ? `Updated ${new Date(health.dataUpdatedAt).toLocaleTimeString()}` : 'Not read yet'}
          </span>
        }
      >
        {indebted.length > 0 && (
          <div className="mb-5 rounded-xl border border-bad/25 bg-bad-soft px-4 py-3">
            <p className="flex items-center gap-2 text-xs font-medium text-bad">
              <AlertCircle {...icon} />
              Execution paused — top up with depositTo before demoing
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-bad">
              Debt on {indebted.map((row) => chainLabelFor(row.key)).join(', ')}. Reactive transactions and callbacks
              are not delivered while debt is above zero. Verification reads still work.
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(health.data ?? []).map((row) => (
            <div key={row.key} className="rounded-xl border border-line bg-paper-50 p-4">
              <div className="text-xs font-medium text-ink-900">{chainLabelFor(row.key)}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric
                  label="Debt"
                  value={row.debt !== undefined ? row.debt.toString() : '—'}
                  tone={row.debt ? 'bad' : 'default'}
                />
                <Metric label="Reserves" value={row.reserves !== undefined ? formatNative(row.reserves, row.key === 'lasna' ? 'lREACT' : 'ETH') : '—'} />
              </div>
            </div>
          ))}
          {!health.data?.length && (
            <p className="text-xs text-ink-400">No chain health reads returned yet.</p>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { key: 'lasna' as const, symbol: 'lREACT', balance: balances.lasna?.value },
            { key: paymentChain, symbol: 'ETH', balance: balances[paymentChain]?.value },
            { key: assetChain, symbol: 'ETH', balance: balances[assetChain]?.value },
          ].map((item) => (
            <div key={item.key} className="rounded-xl border border-line bg-paper-50 p-4">
              <div className="text-xs font-medium text-ink-900">{CHAIN_LABELS[item.key]}</div>
              <div className="tnum mt-2 font-mono text-sm text-ink-700">
                {item.balance !== undefined ? formatNative(item.balance, item.symbol) : '—'}
              </div>
              <div className="mt-1 text-[11px] text-ink-400">
                {address ? 'Connected wallet' : 'Connect wallet to read balances'}
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-line bg-paper-50 p-4">
            <div className="text-xs font-medium text-ink-900">Testnet assets</div>
            <div className="mt-2 font-mono text-sm text-ink-700">{tokenSymbols.join(' · ')}</div>
            <div className="mt-1 text-[11px] text-ink-400">Mintable demo tokens. No real value, no price discovery, no matching engine.</div>
          </div>
        </div>
        {!address && (
          <p className="mt-4 flex items-center gap-2 text-[11px] text-ink-400">
            <Wallet {...icon} /> Native balances require a connected wallet. Contract reads above do not.
          </p>
        )}
      </Panel>

      <Panel title="Protocol caveats" subtitle="What this testnet does not prove">
        <p className="mb-4 rounded-xl border border-warn/25 bg-warn-soft/60 px-3 py-2 text-[11px] leading-relaxed text-warn">
          Prepared Cron100 labels and timings below describe the system <span className="font-medium">after Cron100 cutover</span>.
          The live deployment still uses Cron10 — do not read these figures as current behaviour.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {CAVEATS.map((item) => (
            <div key={item.title} className="rounded-xl border border-line bg-paper-50 p-4">
              <h3 className="text-xs font-medium text-ink-900">{item.title}</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">{item.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 border-t border-line pt-4 font-mono text-[10px] text-ink-400">
          <div>RC {config.reactive.reactiveContract || '— not configured'}</div>
          <div>System {config.reactive.systemContract || '—'}</div>
          {venues.data.map((venue) => (
            <div key={venue.chainId}>
              {venue.chainKey} · payment {venue.paymentEscrow ?? '—'} · asset {venue.assetEscrow ?? '—'}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
