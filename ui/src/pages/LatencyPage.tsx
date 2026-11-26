import LatencyPanel from '../components/LatencyPanel'

export default function LatencyPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Latency evidence</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          Measured from captured transactions, not estimated. The observer's caveats are part of the result.
        </p>
      </div>
      <LatencyPanel />
    </div>
  )
}
