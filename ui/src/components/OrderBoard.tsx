import { useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, RefreshCw } from 'lucide-react'
import { useConfig } from '../lib/config'
import { countdown, formatAmount, formatDeadline, truncate } from '../lib/format'
import { useOrders } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import { useTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'
import { Button, ChainMark, ChainPill, EmptyState, Panel, Spinner, StatusPill, TokenMark, icon } from './ui'

export default function OrderBoard() {
  const navigate = useNavigate()
  const { data: orders, isLoading, isError, error, refetch, isFetching } = useOrders()
  const config = useConfig()
  const now = useNow()
  const paymentToken = useTokenDisplay('payment')
  const assetToken = useTokenDisplay('asset')
  const paymentSymbol = paymentToken.symbol
  const assetSymbol = assetToken.symbol
  const paymentDecimals = paymentToken.decimals
  const assetDecimals = assetToken.decimals
  const configured = !!config.reactive.reactiveContract

  return (
    <Panel
      title="Order book"
      subtitle="Live from the reactive ledger"
      action={
        <div className="flex items-center gap-2">
          {isFetching && <Spinner />}
          <span className="tnum font-mono text-[11px] text-ink-400">{orders?.length ?? 0} orders</span>
          <Button size="sm" icon={<RefreshCw {...icon} />} onClick={() => void refetch()}>
            Refresh
          </Button>
        </div>
      }
      bodyClass=""
    >
      {!configured ? (
        <div className="p-6">
          <EmptyState title="Orders unavailable" message="No settlement contract is configured for this workspace." />
        </div>
      ) : isError ? (
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
      ) : !orders?.length ? (
        <div className="p-6">
          <EmptyState
            title="No open orders"
            message="Create a trade to put a pair on the book."
            action={
              <Button variant="primary" icon={<Plus {...icon} />} onClick={() => navigate('/new')}>
                New trade
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {orders.map(({ id, order }) => {
            const status = deriveStatus(order, now)
            const steps = Number(order.paymentSeen) + Number(order.assetSeen) + (order.settleRequested ? 1 : 0)
            const expired = countdown(order.deadline, now) === 'expired'
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => navigate(`/orders/${id}`)}
                  className="block w-full px-6 py-4 text-left transition-colors hover:bg-paper-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <TokenMark symbol={paymentSymbol} kind="payment" size="sm" mark={paymentToken.mark} color={paymentToken.color} />
                      <span className="text-[13px] font-medium text-ink-900">{paymentSymbol}</span>
                      <span className="text-ink-400">/</span>
                      <TokenMark symbol={assetSymbol} kind="asset" size="sm" mark={assetToken.mark} color={assetToken.color} />
                      <span className="text-[13px] font-medium text-ink-900">{assetSymbol}</span>
                    </span>
                    <StatusPill status={status} />
                  </div>

                  <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                      <div>
                        <div className="flex items-center gap-1 text-[11px] text-ink-400">
                          <ChainMark chain="base" className="h-3 w-3" /> You pay · Base
                        </div>
                        <div className="tnum font-mono text-[15px] font-medium text-ink-900">
                          {formatAmount(order.paymentAmount, paymentDecimals, paymentSymbol)}
                        </div>
                      </div>
                      <ArrowRight {...icon} className="mb-1 text-ink-400" />
                      <div>
                        <div className="flex items-center gap-1 text-[11px] text-ink-400">
                          <ChainMark chain="unichain" className="h-3 w-3" /> You receive · Unichain
                        </div>
                        <div className="tnum font-mono text-[15px] font-medium text-ink-900">
                          {formatAmount(order.assetAmount, assetDecimals, assetSymbol)}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-700">
                      Open <ArrowRight {...icon} />
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="tnum font-mono text-[11px] text-ink-400">{truncate(id, 12, 8)}</span>
                    <ChainPill chain="base" />
                    <ChainPill chain="lasna" />
                    <ChainPill chain="unichain" />
                    <span className="tnum font-mono text-[11px] text-ink-400">{steps} of 3 steps</span>
                    <span className={`tnum font-mono text-[11px] ${expired ? 'text-warn' : 'text-ink-400'}`}>
                      {countdown(order.deadline, now)} · {formatDeadline(order.deadline)}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
