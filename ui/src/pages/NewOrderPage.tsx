import { Link } from 'react-router-dom'
import NewOrderForm from '../components/NewOrderForm'

export default function NewOrderPage() {
  return (
    <div className="space-y-4">
      <Link to="/orders" className="inline-block text-[11px] text-slate-500 hover:text-slate-300">← Orders</Link>
      <NewOrderForm />
    </div>
  )
}
