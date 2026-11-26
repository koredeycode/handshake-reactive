import { Link, useLocation, useSearchParams } from 'react-router-dom'
import EventLog from '../components/dev/EventLog'
import HealthPanel from '../components/dev/HealthPanel'
import LatencyPanel from '../components/dev/LatencyPanel'
import RawStatePanel from '../components/dev/RawStatePanel'
import WarningsPanel from '../components/dev/WarningsPanel'
import { ConvergenceMark, Panel } from '../components/ui'

/** Hidden route: never linked from primary navigation. */
export default function DevPage() {
  const location = useLocation()
  const [params] = useSearchParams()
  const enabled =
    import.meta.env.DEV ||
    import.meta.env.VITE_DEV_TOOLS === '1' ||
    params.has('dev')

  if (!enabled) {
    return (
      <Panel title="Internal diagnostics">
        <p className="text-xs text-ink-500">
          This page is not part of the trading UI. Open it with{' '}
          <Link className="text-accent underline underline-offset-2" to={`${location.pathname}?dev=1`}>
            ?dev=1
          </Link>{' '}
          or build with VITE_DEV_TOOLS=1.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-bad/25 bg-bad-soft px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-bad/25 bg-paper-0 text-bad">
            <ConvergenceMark className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-sm font-medium text-ink-900">Internal diagnostics</h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
              Not linked from primary navigation. Every value here is read from live RPC or the static observer file;
              nothing is seeded, estimated or fabricated. Missing data is shown as not observed yet.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-bad/25 bg-paper-0 px-2.5 py-1 text-[11px] text-bad">
          Internal only
        </span>
      </div>

      <HealthPanel />
      <WarningsPanel />
      <EventLog />
      <LatencyPanel />
      <RawStatePanel />
    </div>
  )
}
