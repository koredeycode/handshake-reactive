import { Link } from 'react-router-dom'
import { Panel } from './ui'

const RUNS = [
  {
    name: 'A · Payment first',
    tone: 'text-payment',
    steps: [
      'Create order with 120s duration (buyer wallet, Base Sepolia).',
      'Lock payment on Base — payment dot fills, status AWAITING_ASSET.',
      'Seller locks asset on Unichain — two callbacks land in seconds.',
      'Copy proof links from the order detail page.',
    ],
  },
  {
    name: 'B · Asset first',
    tone: 'text-asset',
    steps: [
      'Create order with 120s duration.',
      'Seller locks asset on Unichain first — status AWAITING_PAYMENT.',
      'Buyer locks payment on Base — same reactive loop settles both legs.',
      'Compare the hop timeline with run A.',
    ],
  },
  {
    name: 'C · Timeout refund',
    tone: 'text-warn',
    steps: [
      'Create order with 60s duration.',
      'Buyer locks payment; seller deliberately does nothing.',
      'At deadline the next Cron10 tick requests a refund callback.',
      'Payment returns to the buyer; status REFUNDED.',
    ],
  },
]

export default function DemoGuide() {
  return (
    <Panel title="Demo guide" subtitle="Three runs prove the state machine. No keeper, no off-chain arbiter.">
      <div className="grid gap-3 md:grid-cols-3">
        {RUNS.map((run) => (
          <div key={run.name} className="rounded-xl border border-white/[0.06] bg-ink-850/50 p-4">
            <h3 className={`mb-2 text-xs font-semibold ${run.tone}`}>{run.name}</h3>
            <ol className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
              {run.steps.map((step, i) => (
                <li key={step}><span className="mr-1.5 font-mono text-slate-600">{i + 1}.</span>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-slate-500">
        Setup checklist, faucet links and funding commands live in the repo README.{' '}
        <Link to="/new" className="text-payment underline">Create an order →</Link>
      </p>
    </Panel>
  )
}
