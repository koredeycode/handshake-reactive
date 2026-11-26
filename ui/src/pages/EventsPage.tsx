import { useState } from 'react'
import EventLog from '../components/EventLog'

export default function EventsPage() {
  const [key, setKey] = useState(0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Cross-chain event log</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Debugging surface and judge evidence: decoded logs from all three chains, filterable by order and event type.
          </p>
        </div>
        <button type="button" onClick={() => setKey((k) => k + 1)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.08]">
          Reload view
        </button>
      </div>
      <EventLog key={key} />
    </div>
  )
}
