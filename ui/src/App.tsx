import { Link, Navigate, Route, Routes } from 'react-router-dom'
import Header from './components/Header'
import EventsPage from './pages/EventsPage'
import HowItWorksPage from './pages/HowItWorksPage'
import LatencyPage from './pages/LatencyPage'
import NewOrderPage from './pages/NewOrderPage'
import OrderPage from './pages/OrderPage'
import OrdersPage from './pages/OrdersPage'
import VerifyPage from './pages/VerifyPage'
import { REPO_URL } from './lib/chains'
import { ExternalLink } from './components/ui'

export default function App() {
  return (
    <div className="min-h-screen bg-ink-950 text-slate-200">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(139,124,246,0.08),transparent_55%)]" />
      <Header />
      <main className="relative mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:orderId" element={<OrderPage />} />
          <Route path="/new" element={<NewOrderPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/verify/:orderId" element={<VerifyPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/latency" element={<LatencyPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
      </main>
      <footer className="relative border-t border-white/[0.06] px-4 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-[10px] text-slate-600">
          <p>Handshake · trust-minimized cross-chain OTC settlement · testnet demo, eventually atomic by design.</p>
          <div className="flex flex-wrap items-center gap-4">
            <ExternalLink href={`${REPO_URL}/blob/main/README.md`}>README</ExternalLink>
            <ExternalLink href={`${REPO_URL}/blob/main/LATENCY.md`}>LATENCY.md</ExternalLink>
            <ExternalLink href={REPO_URL}>GitHub</ExternalLink>
            <Link to="/verify" className="text-slate-500 hover:text-payment">Public verify</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
