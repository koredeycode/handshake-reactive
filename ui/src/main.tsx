import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { wagmiConfig } from './wagmi'
import { TradeTicketProvider } from './lib/tradeTicket'
import { ApiProvider } from './lib/api'
import { RealtimeProvider } from './lib/RealtimeProvider'
import { Toaster } from 'sonner'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// GitHub Pages 404.html bounce restores the original deep link here.
const redirect = sessionStorage.getItem('handshake:redirect')
if (redirect) {
  sessionStorage.removeItem('handshake:redirect')
  window.history.replaceState(null, '', redirect)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL}>
            <RealtimeProvider>
              <TradeTicketProvider>
                <App />
                <Toaster
                  position="bottom-right"
                  closeButton
                  expand
                  visibleToasts={4}
                  toastOptions={{
                    classNames: {
                      toast: '!rounded-xl !border-line !bg-paper-0 !text-ink-900 !shadow-[0_18px_45px_rgba(24,24,27,0.12)]',
                      title: '!text-[13px] !font-medium',
                      description: '!text-[11px] !text-ink-500',
                      actionButton: '!bg-accent !text-white',
                      cancelButton: '!bg-paper-100 !text-ink-700',
                    },
                  }}
                />
              </TradeTicketProvider>
            </RealtimeProvider>
          </BrowserRouter>
        </ApiProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
