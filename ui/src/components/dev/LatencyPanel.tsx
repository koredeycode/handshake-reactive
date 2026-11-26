import { CHAIN_LABELS, REPO_URL } from '../../lib/chains'
import { deltaMs, formatTimestamp } from '../../lib/format'
import { useLatency, type LatencyRun } from '../../lib/latency'
import { useMarket } from '../../lib/markets'
import { EmptyState, ExternalLink, Metric, Panel, Spinner } from '../ui'

function scenarioTone(scenario: string): string {
  if (scenario.includes('timeout')) return 'text-warn'
  return 'text-ink-700'
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export default function LatencyPanel() {
  const latency = useLatency()
  const { chainKeyFor } = useMarket()
  const data = latency.data
  const runs = data?.runs ?? []
  const totals = runs.map((r) => r.totalMs).filter((n): n is number => typeof n === 'number')
  const baseline = data?.legacyBaselineMs ?? 7000
  const max = Math.max(baseline, ...totals, 1)

  return (
    <div className="space-y-6">
      <Panel
        title="Loop latency"
        subtitle="Wall-clock measurements from ts/observe.ts · static latency.json, read directly by the browser"
        action={
          <span className="font-mono text-[10px] text-ink-400">
            {data?.updatedAt ? `Updated ${formatTimestamp(Date.parse(data.updatedAt) / 1000)}` : 'No observations yet'}
          </span>
        }
      >
        {latency.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-ink-400">
            <Spinner /> Loading latency.json
          </div>
        ) : !runs.length ? (
          <EmptyState
            title="No latency runs recorded yet"
            message="Run ts/observe.ts during a demo and write its output to ui/public/latency.json. The chart will populate from that file; no sample data is invented."
          />
        ) : (
          <>
            <div className="relative mb-6 rounded-xl border border-line bg-paper-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400">
                <span>Total loop latency per run</span>
                <span>Legacy ~{(baseline / 1000).toFixed(0)}s baseline</span>
              </div>
              <div className="flex h-52 items-end gap-3">
                {runs.map((run, i) => {
                  const height = Math.max(2, ((run.totalMs ?? 0) / max) * 100)
                  return (
                    <div key={`${run.orderId ?? i}`} className="group flex h-full flex-1 flex-col justify-end gap-1.5">
                      <span className="text-center font-mono text-[10px] text-ink-500">
                        {run.totalMs ? `${run.totalMs} ms` : '—'}
                      </span>
                      <div
                        className="mx-auto w-full max-w-16 rounded-t-md bg-ink-700"
                        style={{ height: `${height}%` }}
                        title={`${run.scenario}: ${run.totalMs ?? '—'} ms`}
                      />
                      <span className="text-center font-mono text-[10px] text-ink-400">#{i + 1}</span>
                    </div>
                  )
                })}
              </div>
              <div
                className="pointer-events-none absolute left-4 right-4 border-t border-dashed border-warn/60"
                style={{ bottom: `calc(2rem + ${(baseline / max) * 160}px)` }}
              >
                <span className="absolute -top-4 right-0 font-mono text-[10px] text-warn">
                  Legacy ~{(baseline / 1000).toFixed(0)}s
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-[11px] text-ink-400">
                    <th className="px-2 py-2 font-normal">Run</th>
                    <th className="px-2 py-2 font-normal">Scenario</th>
                    <th className="px-2 py-2 font-normal">t0 · 2nd lock</th>
                    <th className="px-2 py-2 font-normal">t1 · reactive</th>
                    <th className="px-2 py-2 font-normal">t2/t3 · callbacks</th>
                    <th className="px-2 py-2 font-normal">Total</th>
                    <th className="px-2 py-2 font-normal">Block deltas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {runs.map((run: LatencyRun, i) => (
                    <tr key={`${run.orderId ?? i}`} className="text-[11px] text-ink-700">
                      <td className="px-2 py-2.5 font-mono">#{i + 1}</td>
                      <td className={`px-2 py-2.5 font-medium ${scenarioTone(run.scenario)}`}>{run.scenario}</td>
                      <td className="px-2 py-2.5 font-mono text-ink-500">
                        {run.t0SecondLockMs ? new Date(run.t0SecondLockMs).toISOString().slice(11, 23) : '—'}
                      </td>
                      <td className="px-2 py-2.5 font-mono text-ink-500">
                        {run.t1ReactiveMs ? `+${deltaMs(run.t0SecondLockMs, run.t1ReactiveMs)}` : '—'}
                      </td>
                      <td className="px-2 py-2.5 font-mono text-ink-500">
                        {run.t2PaymentCallbackMs ? `${CHAIN_LABELS[chainKeyFor('payment')]} +${deltaMs(run.t1ReactiveMs, run.t2PaymentCallbackMs)}` : '—'}
                        <br />
                        {run.t3AssetCallbackMs ? `${CHAIN_LABELS[chainKeyFor('asset')]} +${deltaMs(run.t1ReactiveMs, run.t3AssetCallbackMs)}` : '—'}
                      </td>
                      <td className="px-2 py-2.5 font-mono font-medium text-ink-900">
                        {run.totalMs ? `${run.totalMs} ms` : '—'}
                      </td>
                      <td className="px-2 py-2.5 font-mono text-ink-500">
                        {run.blockDeltas
                          ? `${run.blockDeltas.lockToReactive ?? '—'} / ${run.blockDeltas.reactiveToPayment ?? '—'} / ${run.blockDeltas.reactiveToAsset ?? '—'}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Methodology and caveats">
          <div className="space-y-3 text-xs leading-relaxed text-ink-500">
            <p><span className="font-medium text-ink-900">Wall-clock via WebSocket.</span> The observer subscribes to all three chains and timestamps the second lock, the reactive transaction on Reactive Lasna and each destination callback as its log arrives. This measures the full observed loop, including network propagation and observer delay.</p>
            <p><span className="font-medium text-ink-900">On-chain timestamp bound.</span> Block timestamps have ~1-second granularity, so sub-second deltas cannot be proven from chain data alone. Explorer links let anyone cross-check the ordering.</p>
            <p><span className="font-medium text-ink-900">Observer delay.</span> A slow WS connection inflates measured latency; the numbers are an upper bound, not a guaranteed SLA. Failed callbacks are excluded from successful-loop totals and documented separately.</p>
            <p><span className="font-medium text-ink-900">Legacy baseline.</span> The ~{(baseline / 1000).toFixed(0)}s reference is the typical legacy block interval, not a benchmark of a competing product.</p>
            <div className="rounded-xl border border-line bg-paper-50 p-3">
              <p className="mb-1 font-mono text-[10px] text-ink-400">
                {data?.observer ?? 'Observer metadata unavailable'}
              </p>
              <ExternalLink href={`${REPO_URL}/blob/main/LATENCY.md`} className="text-[11px]">Read LATENCY.md</ExternalLink>
            </div>
          </div>
        </Panel>

        <Panel title="Interpreting the numbers">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Runs captured" value={runs.length} />
            <Metric label="Median total" value={totals.length ? `${median(totals)} ms` : '—'} tone="default" />
            <Metric label="Fastest" value={totals.length ? `${Math.min(...totals)} ms` : '—'} />
            <Metric label="Slowest" value={totals.length ? `${Math.max(...totals)} ms` : '—'} />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            The claim under test: one reactive transaction emits two callbacks that finalize a cross-chain OTC trade in seconds — fast enough to be the settlement layer itself, not just an alert on top of one chain.
          </p>
        </Panel>
      </div>
    </div>
  )
}
