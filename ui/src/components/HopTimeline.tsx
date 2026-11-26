import { buildHops } from '../lib/proofs'
import { ChainPill, ConvergenceMark, Panel, TxLink } from './ui'
import type { Order, ProofData } from '../lib/types'

function pendingText(key: string): string {
  if (key === 'paymentLocked' || key === 'assetLocked') return 'Awaiting this leg'
  if (key === 'reactive') return 'Waiting for the other leg'
  return 'Settlement in progress'
}

function ConvergenceDiagram() {
  return (
    <div className="mb-6 rounded-2xl border border-line bg-paper-50 px-5 py-3">
      <svg viewBox="0 0 480 64" className="h-16 w-full text-ink-400" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 16 C 150 16, 170 32, 240 32" />
          <path d="M10 48 C 150 48, 170 32, 240 32" />
          <path d="M240 32 C 310 32, 330 16, 470 16" />
          <path d="M240 32 C 310 32, 330 48, 470 48" />
        </g>
        <g className="font-mono text-[10px]" fill="currentColor" fillOpacity="0.8">
          <text x="10" y="9">Payment</text>
          <text x="10" y="61">Asset</text>
          <text x="470" y="9" textAnchor="end">Payment out</text>
          <text x="470" y="61" textAnchor="end">Asset out</text>
        </g>
        <circle cx="240" cy="32" r="11" className="fill-paper-0 stroke-accent" strokeWidth="1.5" />
      </svg>
      <div className="-mt-11 flex justify-center">
        <span className="flex h-6 w-6 items-center justify-center text-accent">
          <ConvergenceMark className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}

export default function HopTimeline({
  order,
  proof,
}: {
  order?: Order | null
  proof?: ProofData | null
}) {
  const hops = buildHops(order, proof)
  const done = hops.filter((hop) => hop.event).length

  return (
    <Panel
      title="Settlement trail"
      subtitle="Two legs, one decision, two releases"
      action={
        <span className="tnum font-mono text-[11px] text-ink-400">
          {done} of {hops.length} observed
        </span>
      }
    >
      <ConvergenceDiagram />
      <ol className="relative">
        {hops.map((hop, i) => {
          const event = hop.event
          const decision = hop.key === 'reactive'
          const last = i === hops.length - 1
          return (
            <li key={hop.key} className={`relative flex gap-4 ${last ? '' : 'pb-6'}`}>
              {!last && <span className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-line" />}
              <div className="relative z-10 shrink-0">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-xl border ${
                    event ? 'border-accent/25 bg-accent-soft text-accent' : 'border-line bg-paper-50 text-ink-400'
                  }`}
                >
                  {decision ? (
                    <ConvergenceMark className="h-4 w-4" />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${event ? 'bg-accent' : 'bg-ink-400'}`} />
                  )}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tnum font-mono text-[11px] text-ink-400">{hop.n}</span>
                  <span className={`text-[13px] font-medium ${event ? 'text-ink-900' : 'text-ink-500'}`}>
                    {hop.title}
                  </span>
                  <ChainPill chain={hop.chain} />
                </div>
                <div className="font-mono text-[11px]">
                  {event ? (
                    <TxLink chain={hop.chain} hash={event.txHash} />
                  ) : (
                    <span className="font-sans text-ink-400">{pendingText(hop.key)}</span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
