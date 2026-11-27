import { CHAIN_LABELS } from '../lib/chains'
import { chainKeyFromId } from '../lib/chains'
import { useTradeTicket } from '../lib/tradeTicket'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import type { Order } from '../lib/types'
import { ChainName, ConvergenceMark } from './ui'

/**
 * Compact explanation for either the trade ticket or a stored order. When an
 * order is supplied, chain and token labels come from its per-order venue.
 */
export default function FlowExplainer({ order }: { order?: Order | null }) {
  const ticket = useTradeTicket()
  const payment = useOrderTokenDisplay(order, 'payment')
  const asset = useOrderTokenDisplay(order, 'asset')
  const paymentChain = order ? payment.chain : ticket.paymentChain
  const assetChain = order ? asset.chain : ticket.assetChain

  return (
    <div className="rounded-2xl border border-line bg-paper-50 px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-900">
        <span className="flex h-5 w-5 items-center justify-center rounded-lg border border-line bg-paper-0 text-ink-500">
          <ConvergenceMark className="h-3.5 w-3.5" />
        </span>
        How this trade works
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
        <span className="font-medium text-ink-700">Buyer</span> creates the order and locks{' '}
        <span className="font-mono text-ink-700">{payment.symbol}</span> on <ChainName chain={paymentChain} />.{' '}
        <span className="font-medium text-ink-700">Seller</span> locks{' '}
        <span className="font-mono text-ink-700">{asset.symbol}</span> on <ChainName chain={assetChain} />.
        One decision on <ChainName chain="lasna" /> releases both legs.
      </p>
      {order && (
        <p className="mt-2 text-[10px] text-ink-400">
          Venue: payment {CHAIN_LABELS[chainKeyFromId(order.venue.paymentChainId) ?? 'base']} · asset{' '}
          {CHAIN_LABELS[chainKeyFromId(order.venue.assetChainId) ?? 'unichain']}
        </p>
      )}
    </div>
  )
}
