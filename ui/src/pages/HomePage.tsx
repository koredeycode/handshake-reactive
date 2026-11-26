import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import { Button, EmptyState, Panel, RouteStrip, Spinner, StatusPill, TokenMark, icon } from '../components/ui'
import { countdown, formatAmount, formatDeadline, truncate } from '../lib/format'
import { useOrders } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import { useTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'

/** The newest real orders, shown as a compact read-only preview. */
function OrderBookPreview() {
  const { data: orders, isLoading, isError } = useOrders()
  const now = useNow()
  const payment = useTokenDisplay('payment')
  const asset = useTokenDisplay('asset')
  const preview = orders?.slice(0, 4) ?? []

  return (
    <Panel
      title="Order book preview"
      subtitle="Live from the reactive ledger"
      action={
        orders && orders.length > 0 ? (
          <span className="tnum font-mono text-[11px] text-ink-400">
            Newest {preview.length} of {orders.length}
          </span>
        ) : undefined
      }
      bodyClass=""
    >
      {isError ? (
        <div className="p-6">
          <EmptyState title="Order book unavailable" message="Live orders could not be loaded right now." />
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
          <Spinner /> Loading orders
        </div>
      ) : preview.length === 0 ? (
        <div className="p-6">
          <EmptyState title="No open orders" message="A new trade puts the first pair on the book." />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {preview.map(({ id, order }) => {
            const status = deriveStatus(order, now)
            const expired = countdown(order.deadline, now) === 'expired'
            return (
              <li key={id}>
                <Link
                  to={`/orders/${id}`}
                  className="flex w-full flex-wrap items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-paper-50"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="flex items-center gap-2">
                      <TokenMark symbol={payment.symbol} kind="payment" size="sm" mark={payment.mark} color={payment.color} />
                      <span className="tnum font-mono text-[13px] font-medium text-ink-900">
                        {formatAmount(order.paymentAmount, payment.decimals, payment.symbol)}
                      </span>
                    </span>
                    <ArrowRight {...icon} className="text-ink-400" />
                    <span className="flex items-center gap-2">
                      <TokenMark symbol={asset.symbol} kind="asset" size="sm" mark={asset.mark} color={asset.color} />
                      <span className="tnum font-mono text-[13px] font-medium text-ink-900">
                        {formatAmount(order.assetAmount, asset.decimals, asset.symbol)}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusPill status={status} />
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
          })}
        </ul>
      )}
    </Panel>
  )
}

export default function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-paper-0 px-8 py-10 lg:px-12 lg:py-12">
        <p className="text-xs text-ink-400">Cross-chain OTC settlement</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-medium leading-tight tracking-tight text-ink-900 lg:text-4xl">
          Two legs. One decision. Both legs settle.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-500">
          Lock payment on Base and the asset on Unichain. Reactive Lasna decides once, then releases both legs — no intermediary holding funds.
        </p>
        <RouteStrip className="mt-8" />
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="primary" icon={<Plus {...icon} />} onClick={() => navigate('/new')}>
            New trade
          </Button>
          <Button icon={<ArrowRight {...icon} />} onClick={() => navigate('/orders')}>
            View orders
          </Button>
        </div>
      </section>

      <OrderBookPreview />
    </div>
  )
}
