import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { usePublicClient } from 'wagmi'
import { CHAIN_IDS } from '../lib/chains'
import { useConfig } from '../lib/config'
import { formatTimestamp, normalizeOrderId, truncate } from '../lib/format'
import { fetchEventFeed, logClient, type ProofClients } from '../lib/logs'
import { ChainBadge, CopyButton, EmptyState, Panel, Spinner, TxLink } from './ui'

const EVENT_TYPES = [
  'all',
  'PaymentLocked',
  'AssetLocked',
  'CallbackRequest',
  'PaymentReleased',
  'AssetReleased',
  'PaymentRefunded',
  'AssetRefunded',
  'Cron10',
]

export default function EventLog() {
  const config = useConfig()
  const [params] = useSearchParams()
  const [orderFilter, setOrderFilter] = useState(params.get('order') ?? '')
  const [typeFilter, setTypeFilter] = useState('all')
  const lasna = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const base = logClient(usePublicClient({ chainId: CHAIN_IDS.base }))
  const unichain = logClient(usePublicClient({ chainId: CHAIN_IDS.unichain }))
  const clients: ProofClients = { lasna, base, unichain }

  const feed = useQuery({
    queryKey: ['event-feed', config.reactive.systemContract, config.base.paymentEscrow, config.unichain.assetEscrow],
    refetchInterval: 10_000,
    queryFn: () => fetchEventFeed(config, clients),
  })

  const normalized = normalizeOrderId(orderFilter)
  const rows = useMemo(() => {
    const list = feed.data ?? []
    return list.filter((event) => {
      if (typeFilter !== 'all' && event.label !== typeFilter) return false
      if (normalized && event.fields.orderId?.toLowerCase() !== normalized.toLowerCase()) return false
      return true
    })
  }, [feed.data, typeFilter, normalized])

  const markdown = rows
    .map((e) => `| ${e.label} | ${e.chain} | #${e.blockNumber} | \`${e.txHash}\` | ${e.summary} |`)
    .join('\n')

  return (
    <Panel
      title="Event log"
      subtitle="Decoded logs from Lasna, Base Sepolia and Unichain Sepolia · last ~2,000 blocks per chain"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {feed.isFetching && <Spinner />}
          <button type="button" onClick={() => void feed.refetch()} className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.08]">Refresh</button>
          <CopyButton text={`| Event | Chain | Block | Tx | Fields |\n| --- | --- | --- | --- | --- |\n${markdown}`} label="Copy table" disabled={!rows.length} />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="min-w-[260px] flex-1 rounded-lg border border-white/10 bg-ink-950/70 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-reactive/60"
          placeholder="Filter by order ID (0x… or 64 hex)"
          value={orderFilter}
          onChange={(e) => setOrderFilter(e.target.value)}
        />
        <select
          className="rounded-lg border border-white/10 bg-ink-950/70 px-3 py-2 text-xs text-slate-200 outline-none focus:border-reactive/60"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {EVENT_TYPES.map((type) => <option key={type} value={type}>{type === 'all' ? 'All event types' : type}</option>)}
        </select>
      </div>

      {feed.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500"><Spinner /> Reading logs…</div>
      ) : !rows.length ? (
        <EmptyState
          title="No matching events observed"
          message="Either no logs exist in the scan window, or the filters exclude them. No placeholder events are generated."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.07] text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-2 py-2 font-medium">Event</th>
                <th className="px-2 py-2 font-medium">Chain</th>
                <th className="px-2 py-2 font-medium">Block / time</th>
                <th className="px-2 py-2 font-medium">Tx hash</th>
                <th className="px-2 py-2 font-medium">Decoded fields</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {rows.map((event) => (
                <tr key={event.id} className="text-[11px] text-slate-300 hover:bg-white/[0.025]">
                  <td className="px-2 py-2.5 font-medium text-slate-100">{event.label}</td>
                  <td className="px-2 py-2.5"><ChainBadge chain={event.chain} /></td>
                  <td className="px-2 py-2.5 font-mono text-slate-400">
                    #{event.blockNumber.toString()}
                    <span className="ml-1.5 text-slate-600">{formatTimestamp(event.timestamp)}</span>
                  </td>
                  <td className="px-2 py-2.5"><TxLink chain={event.chain} hash={event.txHash} /></td>
                  <td className="px-2 py-2.5 font-mono text-slate-500" title={JSON.stringify(event.fields)}>
                    {event.fields.orderId ? `${truncate(event.fields.orderId, 10, 6)} · ` : ''}{event.summary || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-[10px] text-slate-600">
        Scan window is bounded by public RPC limits. Set *_fromBlock in public/contracts.json to include older history.
      </p>
    </Panel>
  )
}
