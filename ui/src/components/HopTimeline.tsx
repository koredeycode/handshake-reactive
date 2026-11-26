import { ChainBadge, ExternalLink, TxLink } from './ui'
import { CHAIN_LABELS, EXPLORER_NAMES, txUrl } from '../lib/chains'
import { deltaMs, formatAmount, formatTimestamp } from '../lib/format'
import { runForOrder, useLatency } from '../lib/latency'
import { buildHops } from '../lib/proofs'
import type { Order, ProofData } from '../lib/types'

function StepIcon({ observed }: { observed: boolean }) {
  return observed ? (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-good/40 bg-good/15 text-[11px] text-good">
      ✓
    </span>
  ) : (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[11px] text-slate-500">
      ·
    </span>
  )
}

export default function HopTimeline({
  order,
  proof,
  orderId,
}: {
  order?: Order | null
  proof?: ProofData | null
  orderId?: string
}) {
  const hops = buildHops(order, proof)
  const latency = useLatency()
  const run = runForOrder(latency.data, orderId)
  let previousTimestamp: number | null = null

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-ink-900/80 p-5 shadow-panel">
      <div className="mb-5 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Cross-chain hop timeline</h2>
          <p className="mt-1 text-xs text-slate-500">Observed transactions only · no invented hashes</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-slate-400">
          {hops.filter((h) => h.event).length}/{hops.length} observed
        </span>
      </div>

      <ol className="relative space-y-0">
        {hops.map((hop, i) => {
          const event = hop.event
          const delta = event?.timestamp && previousTimestamp ? deltaMs(previousTimestamp, event.timestamp) : null
          if (event?.timestamp) previousTimestamp = event.timestamp
          const last = i === hops.length - 1
          return (
            <li key={hop.key} className="relative flex gap-3 pb-5 last:pb-0" style={{ animationDelay: `${i * 70}ms` }}>
              {!last && (
                <span className={`absolute left-3 top-7 h-[calc(100%-1.5rem)] w-px ${event ? 'bg-gradient-to-b from-good/50 to-white/10' : 'bg-white/[0.07]'}`} />
              )}
              <div className="relative z-10 shrink-0"><StepIcon observed={!!event} /></div>
              <div className="min-w-0 flex-1 animate-slide-in">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500">{hop.n}</span>
                  <span className={`text-xs font-semibold ${event ? 'text-slate-100' : 'text-slate-500'}`}>{hop.title}</span>
                  <ChainBadge chain={hop.chain} />
                  {delta && <span className="font-mono text-[10px] text-slate-500">+{delta}</span>}
                </div>
                <div className="mt-1.5 space-y-1 pl-6 text-[11px]">
                  {event ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <TxLink chain={hop.chain} hash={event.txHash} />
                        <ExternalLink href={txUrl(hop.chain, event.txHash)} className="text-[10px]">
                          {EXPLORER_NAMES[hop.chain]}
                        </ExternalLink>
                      </div>
                      <div className="font-mono text-[10px] text-slate-500">
                        block #{event.blockNumber.toString()} · {formatTimestamp(event.timestamp)}
                        {event.fields.amount && ` · ${formatAmount(BigInt(event.fields.amount), hop.chain === 'base' ? 6 : 18)}`}
                        {event.fields.nonce && ` · nonce ${event.fields.nonce}`}
                        {hop.note && ` · ${hop.note}`}
                      </div>
                    </>
                  ) : (
                    <p className="text-slate-600">not observed yet — waiting for {CHAIN_LABELS[hop.chain]} logs</p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-5 rounded-xl border border-white/[0.06] bg-ink-950/60 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Latency for this order</div>
        {run ? (
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-300 sm:grid-cols-4">
            <div><span className="block text-[10px] text-slate-500">2nd lock → RC</span>{run.t1ReactiveMs && run.t0SecondLockMs ? deltaMs(run.t0SecondLockMs, run.t1ReactiveMs) : '—'}</div>
            <div><span className="block text-[10px] text-slate-500">RC → Base cb</span>{run.t1ReactiveMs && run.t2PaymentCallbackMs ? deltaMs(run.t1ReactiveMs, run.t2PaymentCallbackMs) : '—'}</div>
            <div><span className="block text-[10px] text-slate-500">RC → Unichain cb</span>{run.t1ReactiveMs && run.t3AssetCallbackMs ? deltaMs(run.t1ReactiveMs, run.t3AssetCallbackMs) : '—'}</div>
            <div className="text-good"><span className="block text-[10px] text-slate-500">Total</span>{run.totalMs ? `${run.totalMs} ms` : '—'}</div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-600">— no latency sample keyed to this order in latency.json (not observed yet)</p>
        )}
      </div>
    </section>
  )
}
