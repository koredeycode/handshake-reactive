import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import NewOrderPage from './pages/NewOrderPage'
import OrderPage from './pages/OrderPage'
import OrdersPage from './pages/OrdersPage'
import VerifyPage from './pages/VerifyPage'

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/orders" replace />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:orderId" element={<OrderPage />} />
        <Route path="/new" element={<NewOrderPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/verify/:orderId" element={<VerifyPage />} />
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Routes>
    </Shell>
  )
}
