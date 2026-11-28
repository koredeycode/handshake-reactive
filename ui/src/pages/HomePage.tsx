import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import TraderGuide from '../components/TraderGuide'
import { Button, ChainMark, EmptyState, Panel, RouteStrip, Skeleton, Spinner, StatusPill, TokenMark, icon } from '../components/ui'
import { CHAIN_LABELS } from '../lib/chains'
import { countdown, formatAmount, formatDeadline, truncate } from '../lib/format'
import { useTradeTicket } from '../lib/tradeTicket'
import { useAllOrders, type AggregatedOrderRow } from '../lib/queries'
import { useOrderStatus } from '../lib/status'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'

function PreviewRow({ row, now }: { row: AggregatedOrderRow; now: number }) {
  const { id, order } = row
  const payment = useOrderTokenDisplay(order, 'payment')
  const asset = useOrderTokenDisplay(order, 'asset')
  const metadataReady = payment.metadataReady && asset.metadataReady
  const status = useOrderStatus(order)
  const expired = countdown(order.deadline, now) === 'expired'
  return (
    <li>
      <Link
        to={`/orders/${id}`}
        className="flex w-full flex-wrap items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-paper-50 sm:px-6"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2" title={`From ${payment.chainLabel}`}>
            <ChainMark chain={payment.chain} className="h-4 w-4" />
            <TokenMark symbol={payment.symbol} kind="payment" size="sm" mark={payment.mark} color={payment.color} loading={!metadataReady} />
            <span className="tnum font-mono text-[13px] font-medium text-ink-900">
              {metadataReady ? formatAmount(order.paymentAmount, payment.decimals, payment.symbol) : <Skeleton className="h-4 w-20" />}
            </span>
          </span>
          <ArrowRight {...icon} className="text-ink-400" />
          <span className="flex items-center gap-2" title={`To ${asset.chainLabel}`}>
            <ChainMark chain={asset.chain} className="h-4 w-4" />
            <TokenMark symbol={asset.symbol} kind="asset" size="sm" mark={asset.mark} color={asset.color} loading={!metadataReady} />
            <span className="tnum font-mono text-[13px] font-medium text-ink-900">
              {metadataReady ? formatAmount(order.assetAmount, asset.decimals, asset.symbol) : <Skeleton className="h-4 w-20" />}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-3">
          <StatusPill status={status!} reason={order.refundReason} order={order} />
          <span className={`tnum hidden font-mono text-[11px] sm:inline ${expired ? 'text-warn' : 'text-ink-400'}`}>
            {countdown(order.deadline, now)}
          </span>
          <span className="tnum hidden font-mono text-[11px] text-ink-400 md:inline" title={formatDeadline(order.deadline)}>
            {truncate(id, 10, 6)}
          </span>
          <ArrowRight {...icon} className="text-ink-400" />
        </span>
      </Link>
    </li>
  )
}

/** The newest real orders across all chain pairs, as a compact read-only preview. */
function OrderBookPreview() {
  const { data: orders, isLoading, isError } = useAllOrders()
  const now = useNow()
  const [visible, setVisible] = useState(10)
  const preview = orders?.slice(0, visible) ?? []
  const hasMore = !!orders && visible < orders.length
  const sentinel = useRef<HTMLDivElement>(null)

  // Append the next ten orders automatically as the user scrolls to the end.
  useEffect(() => {
    if (!hasMore || !sentinel.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible((count) => count + 10)
      },
      { rootMargin: '120px' },
    )
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [hasMore])

  return (
    <Panel
      title="Order book preview"
      subtitle="Live from the reactive ledger"
      action={
        orders && orders.length > 0 ? (
          <span className="tnum font-mono text-[11px] text-ink-400">Showing {preview.length} of {orders.length}</span>
        ) : undefined
      }
      bodyClass=""
    >
      {isError ? (
        <div className="p-6"><EmptyState title="Order book unavailable" message="Live orders could not be loaded right now." /></div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500"><Spinner /> Loading orders</div>
      ) : preview.length === 0 ? (
        <div className="p-6"><EmptyState title="No open orders" message="A new trade puts the first pair on the book." /></div>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {preview.map((row) => <PreviewRow key={row.id} row={row} now={now} />)}
          </ul>
          {hasMore && (
            <div ref={sentinel} className="border-t border-line px-5 py-3 text-center sm:px-6">
              <button
                type="button"
                onClick={() => setVisible((count) => count + 10)}
                className="min-h-9 rounded-full border border-line px-4 text-[11px] font-medium text-ink-700 transition-colors hover:bg-paper-100 hover:text-accent"
              >
                Loading next {Math.min(10, orders.length - visible)} orders…
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const ticket = useTradeTicket()

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-paper-0 px-8 py-10 lg:px-12 lg:py-12">
        <p className="text-xs text-ink-400">Cross-chain OTC settlement</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-medium leading-tight tracking-tight text-ink-900 lg:text-4xl">
          Two legs. One decision. Both legs settle.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-500">
          Trade across Base Sepolia, Unichain Sepolia and Ethereum Sepolia in any direction. Lock payment on {CHAIN_LABELS[ticket.paymentChain]} and the asset on {CHAIN_LABELS[ticket.assetChain]}; Reactive Lasna decides once, then releases both legs — no intermediary holding funds.
        </p>
        <RouteStrip className="mt-8" />
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="primary" icon={<Plus {...icon} />} onClick={() => navigate('/new')}>
            New trade
          </Button>
        </div>
      </section>

      <OrderBookPreview />
      <TraderGuide />
    </div>
  )
}
