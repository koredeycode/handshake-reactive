import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import DevPage from './pages/DevPage'
import FaucetPage from './pages/FaucetPage'
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
        <Route path="/faucet" element={<FaucetPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/verify/:orderId" element={<VerifyPage />} />
        {/* Hidden internal route — intentionally absent from primary navigation. */}
        <Route path="/dev" element={<DevPage />} />
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Routes>
    </Shell>
  )
}
