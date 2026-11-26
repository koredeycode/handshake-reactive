import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, RefreshCw } from 'lucide-react'
import { useAccount } from 'wagmi'
import { CHAIN_LABELS } from '../lib/chains'
import { countdown, formatAmount, formatDeadline, isZeroAddress, truncate } from '../lib/format'
import { useMarket, useMarketConfig } from '../lib/markets'
import { useOrders } from '../lib/queries'
import { deriveStatus, isOpenOrder } from '../lib/status'
import { useTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'
import { Button, ChainMark, ChainPill, EmptyState, Panel, Spinner, StatusPill, TokenMark, icon } from './ui'

type BoardFilter = 'all' | 'open' | 'mine'

const TABS: Array<{ id: BoardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'Mine' },
]

export default function OrderBoard({ scrollable = false }: { scrollable?: boolean }) {
  const navigate = useNavigate()
  const { address } = useAccount()
  const { data: orders, isLoading, isError, error, refetch, isFetching } = useOrders()
  const config = useMarketConfig()
  const { chainKeyFor } = useMarket()
  const paymentChain = chainKeyFor('payment')
  const assetChain = chainKeyFor('asset')
  const now = useNow()
  const [filter, setFilter] = useState<BoardFilter>('all')
  const paymentToken = useTokenDisplay('payment')
  const assetToken = useTokenDisplay('asset')
  const paymentSymbol = paymentToken.symbol
  const assetSymbol = assetToken.symbol
  const paymentDecimals = paymentToken.decimals
  const assetDecimals = assetToken.decimals
  const configured = !!config.reactive.reactiveContract

  const rows = (orders ?? []).filter(({ order }) => {
    if (filter === 'open') return isOpenOrder(order)
    if (filter === 'mine') {
      if (!address) return false
      const wallet = address.toLowerCase()
      return (
        order.buyer.toLowerCase() === wallet ||
        order.seller.toLowerCase() === wallet ||
        (!isZeroAddress(order.winner) && order.winner.toLowerCase() === wallet)
      )
    }
    return true
  })

  return (
    <Panel
      title="Order book"
      subtitle="Live from the reactive ledger"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {isFetching && <Spinner />}
          <div className="flex items-center rounded-xl border border-line bg-paper-50 p-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                aria-pressed={filter === tab.id}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === tab.id
                    ? 'bg-paper-0 text-ink-900 shadow-sm'
                    : 'text-ink-400 hover:text-ink-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="tnum font-mono text-[11px] text-ink-400">{rows.length} orders</span>
          <span className="hidden text-[11px] text-ink-400 sm:inline">Newest first</span>
          <Button size="sm" icon={<RefreshCw {...icon} />} onClick={() => void refetch()}>
            Refresh
          </Button>
        </div>
      }
      bodyClass={scrollable ? 'min-h-0 flex-1 overflow-y-auto' : ''}
      className={scrollable ? 'flex h-full min-h-0 flex-col overflow-hidden' : ''}
    >
      {!configured ? (
        <div className="p-6">
          <EmptyState title="Orders unavailable" message="No settlement contract is configured for this workspace." />
        </div>
      ) : isError ? (
        <div className="p-6">
          <EmptyState
            title="Orders could not be loaded"
            message={error instanceof Error ? error.message : 'Check the connection and try again.'}
            action={<Button onClick={() => void refetch()}>Try again</Button>}
          />
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
          <Spinner /> Loading orders
        </div>
      ) : !rows.length ? (
        <div className="p-6">
          <EmptyState
            title={filter === 'open' ? 'No open orders' : filter === 'mine' ? 'No orders from this wallet' : 'No orders yet'}
            message={
              filter === 'open'
                ? 'Open orders appear here for any seller to match.'
                : filter === 'mine'
                  ? 'Trades you create, match or fulfill will appear here.'
                  : 'Create a trade to put a pair on the book.'
            }
            action={
              <Button variant="primary" icon={<Plus {...icon} />} onClick={() => navigate('/new')}>
                New trade
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ id, order }) => {
            const status = deriveStatus(order, now)
            const steps = Number(order.paymentSeen) + Number(order.assetSeen) + (order.settleRequested ? 1 : 0)
            const expired = countdown(order.deadline, now) === 'expired'
            const open = isOpenOrder(order)
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => navigate(`/orders/${id}`)}
                  className={`block w-full px-6 py-4 text-left transition-colors hover:bg-paper-50 ${
                    open ? 'border-l-2 border-accent bg-accent-soft/40 pl-4' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <TokenMark symbol={paymentSymbol} kind="payment" size="sm" mark={paymentToken.mark} color={paymentToken.color} />
                      <span className="text-[13px] font-medium text-ink-900">{paymentSymbol}</span>
                      <span className="text-ink-400">/</span>
                      <TokenMark symbol={assetSymbol} kind="asset" size="sm" mark={assetToken.mark} color={assetToken.color} />
                      <span className="text-[13px] font-medium text-ink-900">{assetSymbol}</span>
                      {open && (
                        <span className="rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                          Open · {order.assetLockCount.toString()} {order.assetLockCount === 1n ? 'match' : 'matches'}
                        </span>
                      )}
                    </span>
                    <StatusPill status={status} />
                  </div>

                  <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                      <div>
                        <div className="flex items-center gap-1 text-[11px] text-ink-400">
                          <ChainMark chain={paymentChain} /> You pay · {CHAIN_LABELS[paymentChain]}
                        </div>
                        <div className="tnum font-mono text-[15px] font-medium text-ink-900">
                          {formatAmount(order.paymentAmount, paymentDecimals, paymentSymbol)}
                        </div>
                      </div>
                      <ArrowRight {...icon} className="mb-1 text-ink-400" />
                      <div>
                        <div className="flex items-center gap-1 text-[11px] text-ink-400">
                          <ChainMark chain={assetChain} /> You receive · {CHAIN_LABELS[assetChain]}
                        </div>
                        <div className="tnum font-mono text-[15px] font-medium text-ink-900">
                          {formatAmount(order.assetAmount, assetDecimals, assetSymbol)}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-700">
                      Open <ArrowRight {...icon} />
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="tnum font-mono text-[11px] text-ink-400">{truncate(id, 12, 8)}</span>
                    <ChainPill chain={paymentChain} />
                    <ChainPill chain="lasna" />
                    <ChainPill chain={assetChain} />
                    <span className="tnum font-mono text-[11px] text-ink-400">{steps} of 3 steps</span>
                    <span className={`tnum font-mono text-[11px] ${expired ? 'text-warn' : 'text-ink-400'}`}>
                      {countdown(order.deadline, now)} · {formatDeadline(order.deadline)}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
