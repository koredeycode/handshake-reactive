import { Link } from 'react-router-dom'
import { useConfig } from '../lib/config'
import { countdown, formatAmount, truncate } from '../lib/format'
import { useOrders, useTokenMeta } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import { useNow } from '../lib/useNow'
import { EmptyState, Panel, Spinner, StatusPill } from './ui'

function ProgressDots({ payment, asset }: { payment: boolean; asset: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
      <span className={payment ? 'text-payment' : 'text-slate-600'} title={payment ? 'payment locked' : 'payment awaiting'}>
        ●
      </span>
      <span>payment</span>
      <span className="mx-0.5 text-slate-700">·</span>
      <span className={asset ? 'text-asset' : 'text-slate-600'} title={asset ? 'asset locked' : 'asset awaiting'}>
        ●
      </span>
      <span>asset</span>
    </div>
  )
}

export default function OrderBoard() {
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
    <Panel
      title="Order board"
      subtitle={`${orders?.length ?? 0} orders from orderIds(i) / getOrder(id) on Lasna · polls every 5s`}
      action={
        <div className="flex items-center gap-2">
          {isFetching && <Spinner />}
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.08]"
          >
            Refresh
          </button>
          <Link
            to="/new"
            className="rounded-lg bg-gradient-to-r from-reactive to-payment px-3 py-1.5 text-[11px] font-semibold text-ink-950 transition hover:brightness-110"
          >
            + New order
          </Link>
        </div>
      }
    >
      {!configured ? (
        <EmptyState
          title="Reactive contract address not configured"
          message="Set reactive.reactiveContract in ui/public/contracts.json (or VITE_RC_ADDRESS) after deployment. No placeholder orders are shown."
        />
      ) : isError ? (
        <EmptyState
          title="Could not read orders from Lasna"
          message={error instanceof Error ? error.message : 'RPC read failed'}
          action={
            <button type="button" onClick={() => void refetch()} className="text-xs text-payment underline">
              Try again
            </button>
          }
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
          <Spinner /> Reading order IDs…
        </div>
      ) : !orders?.length ? (
        <EmptyState
          title="No orders on Lasna yet"
          message="Create the first order, or paste an existing order ID on the Verify page."
          action={
            <Link to="/new" className="text-xs text-payment underline">
              Open New order
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.07] text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-2 py-2 font-medium">Order ID</th>
                <th className="px-2 py-2 font-medium">Buyer → Seller</th>
                <th className="px-2 py-2 font-medium">Terms</th>
                <th className="px-2 py-2 font-medium">Progress</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Deadline</th>
                <th className="px-2 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {orders.map(({ id, order }) => {
                const status = deriveStatus(order, now)
                return (
                  <tr key={id} className="text-xs text-slate-300 transition hover:bg-white/[0.025]">
                    <td className="px-2 py-3">
                      <Link to={`/orders/${id}`} className="font-mono text-[11px] text-slate-100 hover:text-payment">
                        {truncate(id, 10, 6)}
                      </Link>
                    </td>
                    <td className="px-2 py-3 font-mono text-[11px] text-slate-400">
                      {truncate(order.buyer, 6, 4)} <span className="text-slate-600">→</span> {truncate(order.seller, 6, 4)}
                    </td>
                    <td className="px-2 py-3 text-[11px]">
                      <span className="text-payment">{formatAmount(order.paymentAmount, paymentDecimals, paymentSymbol)}</span>
                      <span className="mx-1.5 text-slate-600">⇄</span>
                      <span className="text-asset">{formatAmount(order.assetAmount, assetDecimals, assetSymbol)}</span>
                    </td>
                    <td className="px-2 py-3">
                      <ProgressDots payment={order.paymentSeen} asset={order.assetSeen} />
                    </td>
                    <td className="px-2 py-3"><StatusPill status={status} /></td>
                    <td className="px-2 py-3 font-mono text-[11px]">
                      <div className={countdown(order.deadline, now) === 'expired' ? 'text-warn' : 'text-slate-300'}>
                        {countdown(order.deadline, now)}
                      </div>
                      <div className="text-[10px] text-slate-600">{new Date(Number(order.deadline) * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'}</div>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <Link to={`/orders/${id}`} className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-200 transition hover:bg-white/[0.09]">
                        Open
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
