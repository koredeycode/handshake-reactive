import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { usePublicClient } from 'wagmi'
import { CHAIN_IDS, CHAIN_LABELS } from '../../lib/chains'

import { formatTimestamp, normalizeOrderId, truncate } from '../../lib/format'
import { fetchEventFeed, logClient, type ProofClients } from '../../lib/logs'
import { useMarket, useMarketConfig } from '../../lib/markets'
import { Button, ChainPill, CopyButton, EmptyState, Panel, Spinner, TxLink, inputClass } from '../ui'

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
  const config = useMarketConfig()
  const { market, chainKeyFor } = useMarket()
  const [params] = useSearchParams()
  const [orderFilter, setOrderFilter] = useState(params.get('order') ?? '')
  const [typeFilter, setTypeFilter] = useState('all')
  const lasna = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const payment = logClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor('payment')] }))
  const asset = logClient(usePublicClient({ chainId: CHAIN_IDS[chainKeyFor('asset')] }))
  const clients: ProofClients = { lasna, payment, asset }
  const chainKeys = { payment: chainKeyFor('payment'), asset: chainKeyFor('asset') }

  const feed = useQuery({
    queryKey: [
      'event-feed',
      market.id,
      config.reactive.systemContract,
      config.base.paymentEscrow,
      config.unichain.assetEscrow,
    ],
    staleTime: 20_000,
    refetchInterval: 30_000, // dev-only; was 10s
    queryFn: () => fetchEventFeed(config, clients, chainKeys),
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
      title="Raw event log"
      subtitle={`Decoded logs from ${CHAIN_LABELS.lasna}, ${CHAIN_LABELS[chainKeys.payment]} and ${CHAIN_LABELS[chainKeys.asset]} · last ~2,000 blocks per chain`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {feed.isFetching && <Spinner />}
          <Button size="sm" onClick={() => void feed.refetch()}>Refresh</Button>
          <CopyButton
            text={`| Event | Chain | Block | Tx | Fields |\n| --- | --- | --- | --- | --- |\n${markdown}`}
            label="Copy table"
          />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className={`${inputClass} min-w-[260px] flex-1`}
          placeholder="Filter by order ID (0x… or 64 hex)"
          value={orderFilter}
          onChange={(e) => setOrderFilter(e.target.value)}
        />
        <select
          className="rounded-xl border border-line bg-paper-0 px-3 py-2 text-xs text-ink-700 outline-none focus:border-accent"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>{type === 'all' ? 'All event types' : type}</option>
          ))}
        </select>
      </div>

      {feed.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-ink-400">
          <Spinner /> Reading logs
        </div>
      ) : !rows.length ? (
        <EmptyState
          title="No matching events observed"
          message="Either no logs exist in the scan window, or the filters exclude them. No placeholder events are generated."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[11px] text-ink-400">
                <th className="px-2 py-2 font-normal">Event</th>
                <th className="px-2 py-2 font-normal">Chain</th>
                <th className="px-2 py-2 font-normal">Block / time</th>
                <th className="px-2 py-2 font-normal">Tx hash</th>
                <th className="px-2 py-2 font-normal">Decoded fields</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((event) => (
                <tr key={event.id} className="text-[11px] text-ink-700 hover:bg-paper-50">
                  <td className="px-2 py-2.5 font-medium text-ink-900">{event.label}</td>
                  <td className="px-2 py-2.5"><ChainPill chain={event.chain} /></td>
                  <td className="px-2 py-2.5 font-mono text-ink-500">
                    #{event.blockNumber.toString()}
                    <span className="ml-1.5 text-ink-400">{formatTimestamp(event.timestamp)}</span>
                  </td>
                  <td className="px-2 py-2.5"><TxLink chain={event.chain} hash={event.txHash} /></td>
                  <td className="px-2 py-2.5 font-mono text-ink-400" title={JSON.stringify(event.fields)}>
                    {event.fields.orderId ? `${truncate(event.fields.orderId, 10, 6)} · ` : ''}
                    {event.summary || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-[10px] text-ink-400">
        Scan window is bounded by public RPC limits. Set *_fromBlock in public/contracts.json to include older history.
      </p>
    </Panel>
  )
}
