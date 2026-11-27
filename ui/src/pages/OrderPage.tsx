import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import OrderDetail from '../components/OrderDetail'
import { normalizeOrderId } from '../lib/format'
import { Button, EmptyState, TxLink, icon } from '../components/ui'

export default function OrderPage() {
  const navigate = useNavigate()
  const { orderId: raw } = useParams()
  const [params] = useSearchParams()
  const orderId = normalizeOrderId(raw)

  if (!orderId) {
    return (
      <EmptyState
        title="Order not found"
        message="Check the order ID and try again."
        action={<Button onClick={() => navigate('/verify')}>Track an order</Button>}
      />
    )
  }

  const tx = params.get('tx')
  return (
    <div className="space-y-6">
      <Button variant="quiet" size="sm" icon={<ArrowLeft {...icon} />} onClick={() => navigate('/orders')}>
        Orders
      </Button>
      {tx && (
        <div className="rounded-lg border border-line bg-paper-0 px-4 py-3 text-[11px] text-ink-500">
          Trade created on Reactive Lasna: <TxLink chain="lasna" hash={tx} />
        </div>
      )}
      <OrderDetail orderId={orderId} />
    </div>
  )
}
