import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, RefreshCw } from 'lucide-react'
import { useConfig } from '../lib/config'
import { countdown, formatAmount, formatDeadline, truncate } from '../lib/format'
import { useOrders, useTokenMeta } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import { useNow } from '../lib/useNow'
import { Button, EmptyState, Panel, Spinner, StatusPill, icon } from './ui'

export default function OrderBoard() {
  const navigate = useNavigate()
  const { data: orders, isLoading, isError, error, refetch, isFetching } = useOrders()
  const config = useConfig()
  const now = useNow()
  const paymentMeta = useTokenMeta('payment')
  const assetMeta = useTokenMeta('asset')
  const paymentSymbol = paymentMeta.data?.symbol ?? 'TestUSD'
  const assetSymbol = assetMeta.data?.symbol ?? 'TEST'
  const paymentDecimals = paymentMeta.data?.decimals ?? 6
  const assetDecimals = assetMeta.data?.decimals ?? 18
  const configured = !!config.reactive.reactiveContract

  return (
    <Panel>
      {!configured ? (
        <EmptyState title="Orders unavailable" message="No settlement contract is configured for this workspace." />
      ) : isError ? (
        <EmptyState
          title="Orders could not be loaded"
          message={error instanceof Error ? error.message : 'Check the connection and try again.'}
          action={<Button onClick={() => void refetch()}>Try again</Button>}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
          <Spinner /> Loading orders
        </div>
      ) : !orders?.length ? (
        <EmptyState
          title="No orders yet"
          message="Create a trade to start settling across both chains."
          action={<Button variant="primary" icon={<Plus {...icon} />} onClick={() => navigate('/new')}>New trade</Button>}
        />
      ) : (
        <>
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="tnum font-mono text-[11px] text-ink-400">{orders.length} orders</p>
            <div className="flex items-center gap-2">
              {isFetching && <Spinner />}
              <Button size="sm" icon={<RefreshCw {...icon} />} onClick={() => void refetch()}>
                Refresh
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[11px] text-ink-400">
                  <th className="py-3 pr-4 font-normal">Order</th>
                  <th className="py-3 pr-4 font-normal">Counterparties</th>
                  <th className="py-3 pr-4 font-normal">Terms</th>
                  <th className="py-3 pr-4 font-normal">Legs</th>
                  <th className="py-3 pr-4 font-normal">Status</th>
                  <th className="py-3 pr-4 font-normal">Deadline</th>
                  <th className="py-3 text-right font-normal"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map(({ id, order }) => {
                  const status = deriveStatus(order, now)
                  const locked = Number(order.paymentSeen) + Number(order.assetSeen)
                  return (
                    <tr key={id} className="text-xs text-ink-700 transition-colors hover:bg-paper-50">
                      <td className="py-4 pr-4">
                        <Link to={`/orders/${id}`} className="tnum font-mono text-[11px] text-ink-900 hover:text-accent">
                          {truncate(id, 10, 6)}
                        </Link>
                      </td>
                      <td className="tnum py-4 pr-4 font-mono text-[11px] text-ink-500">
                        {truncate(order.buyer, 6, 4)} <span className="text-ink-400">to</span> {truncate(order.seller, 6, 4)}
                      </td>
                      <td className="tnum py-4 pr-4 font-mono text-[11px]">
                        <span className="text-ink-900">{formatAmount(order.paymentAmount, paymentDecimals, paymentSymbol)}</span>
                        <span className="mx-2 text-ink-400">for</span>
                        <span className="text-ink-900">{formatAmount(order.assetAmount, assetDecimals, assetSymbol)}</span>
                      </td>
                      <td className="tnum py-4 pr-4 font-mono text-[11px] text-ink-500">{locked} of 2 locked</td>
                      <td className="py-4 pr-4"><StatusPill status={status} /></td>
                      <td className="tnum py-4 pr-4 font-mono text-[11px]">
                        <span className={countdown(order.deadline, now) === 'expired' ? 'text-warn' : 'text-ink-700'}>
                          {countdown(order.deadline, now)}
                        </span>
                        <span className="mt-1 block text-[10px] text-ink-400">{formatDeadline(order.deadline)}</span>
                      </td>
                      <td className="py-4 text-right">
                        <Link
                          to={`/orders/${id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-paper-0 px-3 text-[11px] font-medium text-ink-700 transition-colors hover:bg-paper-100"
                        >
                          Open <ArrowRight {...icon} />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  )
}
