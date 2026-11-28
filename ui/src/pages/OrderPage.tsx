import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import OrderDetail from '../components/OrderDetail'
import TraderGuide from '../components/TraderGuide'
import { ApiError } from '../lib/api'
import { normalizeOrderId } from '../lib/format'
import { useOrderDetail } from '../lib/queries'
import { Button, EmptyState, ExternalLink, TxLink, icon } from '../components/ui'

export default function OrderPage() {
  const navigate = useNavigate()
  const { orderId: raw } = useParams()
  const [params] = useSearchParams()
  const orderId = normalizeOrderId(raw)
  const tx = params.get('tx')
  // The detail view has its own query; this one only classifies a 404 so a
  // freshly created order is not reported as "doesn't exist".
  const detail = useOrderDetail(orderId)
  const is404 = detail.error instanceof ApiError && detail.error.status === 404

  if (!orderId) {
    return (
      <div className="space-y-6">
        <EmptyState
          title="Order link incomplete"
          message="This link does not contain a full 64-character order ID. Open the complete link, or paste it into Track an order."
          action={<Button onClick={() => navigate('/verify')}>Track an order</Button>}
        />
        <TraderGuide />
      </div>
    )
  }

  if (is404) {
    return (
      <div className="space-y-6">
        <Button variant="quiet" size="sm" icon={<ArrowLeft {...icon} />} onClick={() => navigate('/orders')}>
          Orders
        </Button>
        <EmptyState
          title="Order may not be indexed yet"
          message="The public indexer can be up to ~60 seconds behind the chain, and a just-created order (or a shortened ID) may not be searchable yet. Refresh, or follow the transaction directly on Reactscan."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button icon={<RefreshCw {...icon} />} onClick={() => void detail.refetch()}>Refresh</Button>
              {tx ? (
                <TxLink chain="lasna" hash={tx} label="View creation tx on Reactscan" />
              ) : (
                <ExternalLink href="https://lasna.reactscan.net/">Search Reactscan</ExternalLink>
              )}
            </div>
          }
        />
        <TraderGuide />
      </div>
    )
  }

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
      <TraderGuide />
    </div>
  )
}
