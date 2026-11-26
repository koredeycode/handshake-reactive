import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import FlowExplainer from '../components/FlowExplainer'
import NewOrderForm from '../components/NewOrderForm'
import { Button, RouteStrip, icon } from '../components/ui'

export default function NewOrderPage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Button variant="quiet" size="sm" icon={<ArrowLeft {...icon} />} onClick={() => navigate('/orders')}>
            Trade
          </Button>
          <h1 className="mt-4 text-xl font-medium text-ink-900">New trade</h1>
          <p className="mt-1 text-xs text-ink-500">Define the terms. Both legs lock before settlement begins.</p>
        </div>
        <RouteStrip />
      </div>
      <FlowExplainer />
      <NewOrderForm />
    </div>
  )
}
