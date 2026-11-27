import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { TRADING_CHAIN_KEYS, type TradingChainKey } from '../lib/chains'
import { countdown, formatAmount, formatDeadline, isZeroAddress, truncate } from '../lib/format'
import { useAllOrders, type AggregatedOrderRow } from '../lib/queries'
import { deriveStatus, isOpenOrder } from '../lib/status'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { pairId, venueOfOrder } from '../lib/venue'
import { useNow } from '../lib/useNow'
import { Button, ChainMark, ChainPill, EmptyState, PairSelect, Panel, Spinner, StatusPill, TokenMark, icon } from './ui'

type BoardFilter = 'all' | 'open' | 'mine'

const TABS: Array<{ id: BoardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'Mine' },
]

const PAIRS = TRADING_CHAIN_KEYS.flatMap((payment) =>
  TRADING_CHAIN_KEYS.filter((asset) => asset !== payment).map((asset) => ({ payment, asset })),
)

/** Each row derives chain marks and token marks from the order's own venue. */
function OrderRow({ row, now }: { row: AggregatedOrderRow; now: number }) {
  const { id, order } = row
  const payment = useOrderTokenDisplay(order, 'payment')
  const asset = useOrderTokenDisplay(order, 'asset')
  const paymentVenue = venueOfOrder(order, 'payment')
  const assetVenue = venueOfOrder(order, 'asset')
  const status = deriveStatus(order, now)
  const steps = Number(order.paymentSeen) + Number(order.assetSeen) + (order.settleRequested ? 1 : 0)
  const expired = countdown(order.deadline, now) === 'expired'
  const open = isOpenOrder(order)

  return (
    <li>
      <Link
        to={`/orders/${id}`}
        className={`block w-full px-5 py-4 text-left transition-colors hover:bg-paper-50 sm:px-6 ${
          open ? 'border-l-2 border-accent bg-accent-soft/40 pl-4' : ''
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex flex-wrap items-center gap-2">
            <TokenMark symbol={payment.symbol} kind="payment" size="sm" mark={payment.mark} color={payment.color} />
            <span className="text-[13px] font-medium text-ink-900">{payment.symbol}</span>
            {!payment.verified && <span className="rounded-full border border-warn/25 bg-warn-soft px-1.5 py-0.5 text-[9px] text-warn" title={payment.address ?? undefined}>Unverified</span>}
            <span className="text-ink-400">/</span>
            <TokenMark symbol={asset.symbol} kind="asset" size="sm" mark={asset.mark} color={asset.color} />
            <span className="text-[13px] font-medium text-ink-900">{asset.symbol}</span>
            {!asset.verified && <span className="rounded-full border border-warn/25 bg-warn-soft px-1.5 py-0.5 text-[9px] text-warn" title={asset.address ?? undefined}>Unverified</span>}
            {open && (
              <span className="rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                Open · {order.assetLockCount.toString()} {order.assetLockCount === 1n ? 'match' : 'matches'}
              </span>
            )}
          </span>
          <StatusPill status={status} />
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="flex items-center gap-1 text-[11px] text-ink-400">
                <ChainMark chain={payment.chain} /> Payment leg · {payment.chainLabel}
              </div>
              <div className="tnum font-mono text-[15px] font-medium text-ink-900">
                {formatAmount(order.paymentAmount, payment.decimals, payment.symbol)}
              </div>
            </div>
            <ArrowRight {...icon} className="mb-1 text-ink-400" />
            <div>
              <div className="flex items-center gap-1 text-[11px] text-ink-400">
                <ChainMark chain={asset.chain} /> Asset leg · {asset.chainLabel}
              </div>
              <div className="tnum font-mono text-[15px] font-medium text-ink-900">
                {formatAmount(order.assetAmount, asset.decimals, asset.symbol)}
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-700">
            Details <ArrowRight {...icon} />
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="tnum font-mono text-[11px] text-ink-400">{truncate(id, 12, 8)}</span>
          <ChainPill chain={paymentVenue.chainKey} />
          <ChainPill chain="lasna" />
          <ChainPill chain={assetVenue.chainKey} />
          <span className="tnum font-mono text-[11px] text-ink-400">{steps} of 3 steps</span>
          <span className={`tnum font-mono text-[11px] ${expired ? 'text-warn' : 'text-ink-400'}`}>
            {countdown(order.deadline, now)} · {formatDeadline(order.deadline)}
          </span>
        </div>
      </Link>
    </li>
  )
}

export default function OrderBoard({ scrollable = false }: { scrollable?: boolean }) {
  const navigate = useNavigate()
  const { address } = useAccount()
  const { data: orders, isLoading, isError, error, refetch, isFetching } = useAllOrders()
  const now = useNow()
  const [filter, setFilter] = useState<BoardFilter>('all')
  const [pair, setPair] = useState<string>('all')

  const rows = (orders ?? []).filter(({ order }) => {
    if (pair !== 'all') {
      const payment = venueOfOrder(order, 'payment').chainKey
      const asset = venueOfOrder(order, 'asset').chainKey
      if (pairId(payment, asset as TradingChainKey) !== pair) return false
    }
    if (filter === 'open') return isOpenOrder(order)
    if (filter === 'mine') {
      if (!address) return false
      const wallet = address.toLowerCase()
      return (
        order.buyer.toLowerCase() === wallet ||
        order.seller.toLowerCase() === wallet ||
        (!isZeroAddress(order.winner) && order.winner.toLowerCase() === wallet)
      )
    }
    return true
  })

  return (
    <Panel
      title="Order book"
      subtitle="Live from the single reactive ledger · all chain pairs"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {isFetching && <Spinner />}
          <div className="flex items-center rounded-xl border border-line bg-paper-50 p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                aria-pressed={filter === tab.id}
                className={`inline-flex min-h-10 items-center rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === tab.id ? 'bg-paper-0 text-ink-900 shadow-sm' : 'text-ink-400 hover:text-ink-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="tnum font-mono text-[11px] text-ink-400">{rows.length} orders</span>
          <span className="hidden text-[11px] text-ink-400 sm:inline">Newest first</span>
          <Button size="sm" icon={<RefreshCw {...icon} />} onClick={() => void refetch()}>
            Refresh
          </Button>
        </div>
      }
      bodyClass={scrollable ? 'min-h-0 flex-1 overflow-y-auto' : ''}
      className={scrollable ? 'flex h-full min-h-0 flex-col overflow-hidden' : ''}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
        <span className="mr-1 text-[11px] text-ink-400">Chain pair</span>
        <PairSelect
          value={pair}
          onChange={setPair}
          options={PAIRS.map(({ payment, asset }) => ({ id: pairId(payment, asset), payment, asset }))}
        />
      </div>

      {isError ? (
        <div className="p-6">
          <EmptyState
            title="Orders could not be loaded"
            message={error instanceof Error ? error.message : 'Check the connection and try again.'}
            action={<Button onClick={() => void refetch()}>Try again</Button>}
          />
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
          <Spinner /> Loading orders
        </div>
      ) : !rows.length ? (
        <div className="p-6">
          <EmptyState
            title={filter === 'open' ? 'No open orders' : filter === 'mine' ? 'No orders from this wallet' : 'No orders yet'}
            message={
              filter === 'open'
                ? 'Open orders appear here for any seller to match.'
                : filter === 'mine'
                  ? 'Trades you create, match or fulfill will appear here.'
                  : 'Create a trade to put a pair on the book.'
            }
            action={
              <Button variant="primary" icon={<Plus {...icon} />} onClick={() => navigate('/new')}>
                New trade
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <OrderRow key={row.id} row={row} now={now} />
          ))}
        </ul>
      )}
    </Panel>
  )
}
