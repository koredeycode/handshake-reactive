import { useState } from 'react'
import DemoGuide from '../components/DemoGuide'
import EventLog from '../components/EventLog'
import HealthPanel from '../components/HealthPanel'
import OrderBoard from '../components/OrderBoard'

export default function OrdersPage() {
  const [showLog, setShowLog] = useState(false)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">Operator console</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Read-first view of the live three-chain system. Every value comes from a contract view or an observed transaction; missing data is shown as <span className="font-mono text-slate-300">—</span> with a reason.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-white/[0.08]"
        >
          {showLog ? 'Hide event log' : 'Show event log'}
        </button>
      </div>
      <HealthPanel />
      <OrderBoard />
      <DemoGuide />
      {showLog && <EventLog />}
    </div>
  )
}
