import { REPO_URL } from '../lib/chains'
import { ExternalLink, Panel } from './ui'

const STEPS = [
  {
    n: '01',
    title: 'Lock on two chains',
    chain: 'Base Sepolia + Unichain Sepolia',
    body: 'Buyer locks payment in PaymentEscrow; seller locks the asset in AssetEscrow. Each escrow pins one test token, one reactive contract, and one callback proxy. Terminal states and monotonic nonces make replays harmless.',
  },
  {
    n: '02',
    title: 'One reactive transaction decides',
    chain: 'Reactive Lasna · 5318007',
    body: 'Global subscriptions deliver both Locked events to react(). When both terms match and the deadline has not passed, the arbiter bumps its nonce and requests two callbacks from a single transaction. A Cron10 tick handles expired orders.',
  },
  {
    n: '03',
    title: 'Two authenticated callbacks settle',
    chain: 'Base Sepolia + Unichain Sepolia',
    body: 'The system contract posts each callback through the destination proxy. release() pays the counterparty; refund() returns funds to the depositor. Only after both terminal events are seen is the order closed.',
  },
]

const LIMITATIONS = [
  ['Eventually atomic, not single-transaction atomic', 'One leg can release while the second callback is still in flight. We minimise the window by requesting both callbacks in one reactive transaction, and each escrow is independently correct — but this is not bridge-grade atomicity.'],
  ['Testnet assets only', 'TestUSD and TEST are mintable demo tokens. No real value, no price discovery, no matching engine.'],
  ['Cron cost & ~10s granularity', 'The deadline sweep runs on Cron10. Expired orders settle within roughly one tick, not at the exact second.'],
  ['Debt pauses execution', 'Any non-zero debt at the system contract or callback proxy stops delivery until depositTo clears it. The header banner surfaces this before a demo.'],
  ['No cancellation in MVP', 'There is no buyer cancel path before the deadline; an abandoned order refunds automatically once it expires.'],
  ['Pre-flight terms hash', 'The UI computes the expected termsHash from getOrder(id) before enabling a lock. Confirm it out-of-band with your counterparty — the RC verifies it on-chain.'],
]

export default function HowItWorks() {
  return (
    <div className="space-y-4">
      <Panel title="How Handshake settles" subtitle="Cross-chain RFQ / OTC settlement for DeFi liquidity — not generic payments.">
        <div className="grid gap-3 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.n} className="relative rounded-xl border border-white/[0.06] bg-ink-850/50 p-4">
              {i < STEPS.length - 1 && (
                <span className="absolute -right-2 top-1/2 hidden h-px w-4 bg-white/20 lg:block" />
              )}
              <div className="mb-2 font-mono text-xs text-reactive">{step.n}</div>
              <h3 className="text-sm font-semibold text-slate-100">{step.title}</h3>
              <p className="mt-1 font-mono text-[10px] text-slate-500">{step.chain}</p>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-reactive/20 bg-reactive/[0.06] p-4">
          <h3 className="text-xs font-semibold text-slate-100">Callback authentication</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            The destination escrow accepts a callback only if it comes from its pinned proxy (<code className="font-mono text-slate-300">onlyServiceProvider</code>) <em>and</em> carries the injected reactive sender (<code className="font-mono text-slate-300">onlyCallbackSender</code>). The proxy overwrites the first payload slot with the requesting RC address; passing <code className="font-mono text-slate-300">address(0)</code> there is intentional. A stale nonce or terminal leg state makes replay a no-op.
          </p>
        </div>
      </Panel>

      <Panel title="Honest limitations" subtitle="What this demo does not prove">
        <div className="grid gap-2 md:grid-cols-2">
          {LIMITATIONS.map(([title, body]) => (
            <div key={title} className="rounded-xl border border-white/[0.06] bg-ink-850/40 p-3">
              <h4 className="text-xs font-semibold text-warn">{title}</h4>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-[11px]">
          <ExternalLink href={`${REPO_URL}`} className="text-xs">Repository</ExternalLink>
          <ExternalLink href={`${REPO_URL}/blob/main/README.md`} className="text-xs">README</ExternalLink>
          <ExternalLink href={`${REPO_URL}/blob/main/LATENCY.md`} className="text-xs">LATENCY.md</ExternalLink>
          <ExternalLink href="https://lasna.reactscan.net/" className="text-xs">Reactscan</ExternalLink>
        </div>
      </Panel>
    </div>
  )
}
