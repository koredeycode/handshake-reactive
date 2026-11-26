import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import OrderDetail from '../components/OrderDetail'
import { normalizeOrderId } from '../lib/format'
import { useEnsureMarket } from '../lib/markets'
import { Button, EmptyState, Panel, Spinner, TxLink, icon } from '../components/ui'

export default function OrderPage() {
  const navigate = useNavigate()
  const { orderId: raw } = useParams()
  const [params] = useSearchParams()
  const orderId = normalizeOrderId(raw)
  const { ready, isLoading } = useEnsureMarket(orderId)

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
      {!ready ? (
        <Panel>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
              <Spinner /> Finding the order's market
            </div>
          ) : (
            <EmptyState title="Order not found" message="Check the order ID and try again." />
          )}
        </Panel>
      ) : (
        <OrderDetail orderId={orderId} />
      )}
    </div>
  )
}
