import { useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { ConvergenceMark, icon } from './ui'

/**
 * In-product settlement primer. Reachable from the home page and every order
 * detail surface (both the authenticated detail and the public tracker), not
 * just the internal diagnostics route. Collapsed by default so it never
 * displaces the live order state on a 360px screen.
 */
export default function TraderGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section id="settlement-guide" className="rounded-2xl border border-line bg-paper-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="settlement-guide-body"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-paper-50"
      >
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink-900">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border border-line bg-paper-0 text-ink-500">
            <ConvergenceMark className="h-3.5 w-3.5" />
          </span>
          How settlement works · what can go wrong
        </span>
        <ChevronDown {...icon} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id="settlement-guide-body" className="space-y-5 border-t border-line px-5 py-5">
          <p className="text-[11px] leading-relaxed text-ink-500">
            Every order moves through the same three states. Nothing holds your funds in between — each leg sits in its
            own venue-bound escrow on its own chain, and one reactive transaction decides the outcome.
          </p>

          <ol className="grid gap-2 sm:grid-cols-3">
            {[
              {
                n: '01',
                title: 'Pending',
                body: 'Buyer locks payment on the payment chain; seller locks the asset on the other chain. Until both locks are seen, neither leg can move. The countdown is the deadline, not a promise of settlement.',
              },
              {
                n: '02',
                title: 'Decision',
                body: 'Once both locks are observed, one transaction on Reactive Lasna records the settle decision and requests both release callbacks together. The two callbacks can arrive a second or two apart.',
              },
              {
                n: '03',
                title: 'Released or refunded',
                body: 'Both legs close and the order is finished. If the deadline passes first, the refund path runs instead. The settlement trail shows the actual transaction hashes for whichever path happened.',
              },
            ].map((step) => (
              <li key={step.n} className="rounded-xl border border-line bg-paper-50 p-3">
                <div className="tnum font-mono text-[10px] text-ink-400">{step.n}</div>
                <h3 className="mt-1 text-[12px] font-medium text-ink-900">{step.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="rounded-xl border border-line bg-paper-50 p-4">
            <h3 className="text-[12px] font-medium text-ink-900">Expected timing</h3>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-ink-500">
              <li>• Both locks → decision: normally seconds after the second lock is indexed.</li>
              <li>• Decision → release: typically 1–2 seconds; one chain can update slightly before the other.</li>
              <li>• Deadline refunds, live today: Cron10 sweeps about every 10 seconds, plus backlog.</li>
              <li>• After the Cron100 cutover (prepared, not live): roughly one ~2 minute tick, up to 8 orders per tick.</li>
              <li>• The public view can lag up to ~60 seconds behind the chains. Refresh before escalating.</li>
            </ul>
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-[12px] font-medium text-ink-900">
              <AlertTriangle {...icon} className="text-warn" />
              What can go wrong
            </h3>
            <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-ink-500">
              <li>
                <span className="font-medium text-ink-700">Seller never locks.</span> Your payment stays in escrow until
                the deadline; a refund then has to be requested by the cron sweep (live) or by the permissionless{' '}
                <code className="font-mono">expire()</code> path planned for after Cron100. Until a refund is actually
                recorded, the pill reads “Waiting for expiry” or “Needs attention” — no decision recorded yet; check the
                trail for a real refund hash.
              </li>
              <li>
                <span className="font-medium text-ink-700">You lost an open-order race.</span> The first valid asset lock
                wins; later sellers are refunded automatically. Today that looks like a plain “Refunded” pill — check the
                winner on the order detail to confirm another seller took it.
              </li>
              <li>
                <span className="font-medium text-ink-700">Stalled past the deadline with no decision.</span> Refresh the
                page, then follow the hashes in the settlement trail to Reactscan / the origin-chain explorer. If no
                refund transaction appears, record the order ID, terms hash and observed hashes before contacting support.
              </li>
              <li>
                <span className="font-medium text-ink-700">The operator cannot rescue locked funds.</span> The owner
                rescue functions planned with Cron100 can recover only mistaken transfers or dust — never a locked leg.
                Never send tokens directly to an escrow or to the reactive contract.
              </li>
            </ul>
          </div>

          <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-ink-400">
            This is a testnet demonstration with no price discovery and no intermediary holding funds. Timings are
            observations, not guarantees; a refund is only final when its transaction appears in the trail.
          </p>
        </div>
      )}
    </section>
  )
}
