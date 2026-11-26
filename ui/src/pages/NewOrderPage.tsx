import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import NewOrderForm from '../components/NewOrderForm'
import { Button, icon } from '../components/ui'

export default function NewOrderPage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6">
      <div>
        <Button variant="quiet" size="sm" icon={<ArrowLeft {...icon} />} onClick={() => navigate('/orders')}>
          Orders
        </Button>
        <h1 className="mt-4 text-xl font-medium text-ink-900">New trade</h1>
        <p className="mt-1 text-xs text-ink-500">Define the terms. Both legs lock before settlement begins.</p>
      </div>
      <NewOrderForm />
    </div>
  )
}
