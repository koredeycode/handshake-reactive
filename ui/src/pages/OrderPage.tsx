import { Link, useParams, useSearchParams } from 'react-router-dom'
import OrderDetail from '../components/OrderDetail'
import { normalizeOrderId } from '../lib/format'
import { TxLink } from '../components/ui'

export default function OrderPage() {
  const { orderId: raw } = useParams()
  const [params] = useSearchParams()
  const orderId = normalizeOrderId(raw)
  if (!orderId) {
    return (
      <div className="rounded-2xl border border-bad/30 bg-bad/[0.06] p-6 text-sm text-red-200">
        Malformed order ID. <Link to="/orders" className="underline">Back to order board</Link>
      </div>
    )
  }
  const tx = params.get('tx')
  return (
    <div className="space-y-4">
      <Link to="/orders" className="inline-block text-[11px] text-slate-500 hover:text-slate-300">← Orders</Link>
      {tx && (
        <div className="rounded-lg border border-good/25 bg-good/[0.06] px-3 py-2 text-[11px] text-slate-300">
          Order creation tx on Lasna: <TxLink chain="lasna" hash={tx} />
        </div>
      )}
      <OrderDetail orderId={orderId} />
    </div>
  )
}
