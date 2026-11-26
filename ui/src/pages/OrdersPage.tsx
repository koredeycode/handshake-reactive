import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import OrderBoard from '../components/OrderBoard'
import { Button, icon } from '../components/ui'

export default function OrdersPage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-ink-900">Orders</h1>
          <p className="mt-1 text-xs text-ink-500">Cross-chain trades on the settlement ledger</p>
        </div>
        <Button variant="primary" icon={<Plus {...icon} />} onClick={() => navigate('/new')}>
          New trade
        </Button>
      </div>
      <OrderBoard />
    </div>
  )
}
