import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Hex } from 'viem'
import { chainKeyFromId, CHAIN_LABELS } from '../lib/chains'
import { truncate } from '../lib/format'
import { useOrderEvents } from '../lib/queries'
import { Button, ExternalLink, Spinner, TxLink, icon } from './ui'

/**
 * Power-user view of the API's decoded event feed. The query is the shared
 * `useOrderEvents` hook (GET /orders/:id/events) and is only enabled once the
 * panel is expanded, so the common read-only path pays nothing for it.
 */
export default function RawEventsPanel({ orderId }: { orderId?: Hex | string | null }) {
  const [open, setOpen] = useState(false)
  const events = useOrderEvents(open ? orderId : null)
  const rows = events.data?.events ?? []

  return (
    <section className="rounded-2xl border border-line bg-paper-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="raw-events-body"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-paper-50"
      >
        <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-900">
          Raw decoded events
          <span className="tnum rounded-full border border-line bg-paper-50 px-2 py-0.5 font-mono text-[10px] font-normal text-ink-400">
            {open && events.data ? `${rows.length} rows` : 'advanced'}
          </span>
        </span>
        <ChevronDown {...icon} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id="raw-events-body" className="border-t border-line px-5 py-4">
          <p className="text-[11px] leading-relaxed text-ink-500">
            Read from the public event feed. An event can appear here before (or without) being folded into the order
            state — compare hashes with the settlement trail before drawing conclusions.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {events.isFetching && <Spinner />}
            <Button size="sm" onClick={() => void events.refetch()}>Refresh events</Button>
          </div>
          {events.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-ink-400"><Spinner /> Loading events</div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-[11px] text-ink-400">No decoded events returned for this order ID.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-50">
              {rows.map((event) => {
                const chain = chainKeyFromId(event.chainId)
                return (
                  <li key={event.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      <span className="font-medium text-ink-900">{event.eventName}</span>
                      <span className="text-ink-400">{chain ? CHAIN_LABELS[chain] : `Chain ${event.chainId}`}</span>
                      <span className="tnum font-mono text-ink-400">#{event.blockNumber}</span>
                      {chain ? (
                        <TxLink chain={chain} hash={event.txHash} label={truncate(event.txHash, 8, 6)} />
                      ) : (
                        <ExternalLink href={`https://lasna.reactscan.net/tx/${event.txHash}`}>
                          {truncate(event.txHash, 8, 6)}
                        </ExternalLink>
                      )}
                    </div>
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-ink-400">
                      {JSON.stringify(event.payload, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}
                    </pre>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
