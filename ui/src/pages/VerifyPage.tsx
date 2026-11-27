import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import HopTimeline from '../components/HopTimeline'
import TradeTicket from '../components/TradeTicket'
import {
  Button,
  ChainPill,
  EmptyState,
  ExternalLink,
  Metric,
  Panel,
  Spinner,
  StatusPill,
  inputClass,
  icon,
} from '../components/ui'
import { CHAIN_LABELS, EXPLORER_NAMES, txUrl } from '../lib/chains'
import { configuredAddress, useConfig } from '../lib/config'
import { countdown, formatAmount, formatDeadline, normalizeOrderId, truncate } from '../lib/format'
import { orderChainKeys, useProof } from '../lib/proofs'
import { useOrder } from '../lib/queries'
import { useOrderStatus } from '../lib/status'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'
import type { ChainKey } from '../lib/chains'
import type { Hex } from 'viem'
import type { ProofEvent } from '../lib/types'

function ExplorerCard({
  chain,
  event,
  description,
}: {
  chain: ChainKey
  event?: ProofEvent | null
  description: string
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper-50 p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink-900">{EXPLORER_NAMES[chain]}</h3>
        <ChainPill chain={chain} />
      </div>
      <div className="mt-4 font-mono text-[11px]">
        {event ? (
          <ExternalLink href={txUrl(chain, event.txHash)} className="min-h-10 max-w-full truncate" title={event.txHash}>
            {truncate(event.txHash, 10, 6)}
          </ExternalLink>
        ) : (
          <span className="font-sans text-ink-400">Settlement in progress</span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-400">{description}</p>
    </div>
  )
}

/** Public, wallet-free detail. A bare order ID is enough: one RC holds all venues. */
function VerifyDetail({ orderId }: { orderId: Hex }) {
  const config = useConfig()
  const now = useNow()
  const orderQuery = useOrder(orderId)
  const order = orderQuery.data
  const proof = useProof(orderId).data
  const status = useOrderStatus(order)
  const notFound = !orderQuery.isLoading && !order
  const paymentToken = useOrderTokenDisplay(order, 'payment')
  const assetToken = useOrderTokenDisplay(order, 'asset')
  const chainKeys = orderChainKeys(order)

  if (!configuredAddress(config.reactive.reactiveContract)) {
    return <EmptyState title="Order unavailable" message="Order lookup is unavailable in this workspace." />
  }
  if (orderQuery.isLoading) {
    return (
      <Panel>
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500"><Spinner /> Loading order</div>
      </Panel>
    )
  }
  if (notFound) {
    return <EmptyState title="No order found" message="Check the order ID and try again." />
  }

  return (
    <div className="space-y-6">
      <Panel title={`Order ${truncate(orderId, 12, 8)}`} subtitle="Terms read from the single reactive contract" action={status && <StatusPill status={status} />}>
        <TradeTicket
          pay={{
            symbol: paymentToken.symbol,
            chain: chainKeys.payment,
            kind: 'payment',
            mark: paymentToken.mark,
            color: paymentToken.color,
            amount: formatAmount(order?.paymentAmount, paymentToken.decimals),
            tokenAddress: paymentToken.address,
            verified: paymentToken.verified,
            hint: `You pay · ${paymentToken.chainLabel}`,
          }}
          receive={{
            symbol: assetToken.symbol,
            chain: chainKeys.asset,
            kind: 'asset',
            mark: assetToken.mark,
            color: assetToken.color,
            amount: formatAmount(order?.assetAmount, assetToken.decimals),
            tokenAddress: assetToken.address,
            verified: assetToken.verified,
            hint: `You receive · ${assetToken.chainLabel}`,
          }}
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Buyer" value={truncate(order?.buyer, 8, 6)} />
          <Metric label="Seller" value={truncate(order?.seller, 8, 6)} />
          <Metric label="Deadline" value={formatDeadline(order?.deadline ?? null)} />
          <Metric label="Time remaining" value={countdown(order?.deadline ?? null, now)} />
        </div>
        {order && (
          <p className="mt-4 border-t border-line pt-4 text-[10px] leading-relaxed text-ink-400">
            Venue · payment {CHAIN_LABELS[chainKeys.payment]} ({order.venue.paymentEscrow}) · asset {CHAIN_LABELS[chainKeys.asset]} ({order.venue.assetEscrow})
          </p>
        )}
      </Panel>

      <div>
        <h2 className="mb-3 text-sm font-medium text-ink-900">Explorers</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <ExplorerCard chain={chainKeys.payment} event={proof?.paymentLocked} description={`Payment locked on ${CHAIN_LABELS[chainKeys.payment]}`} />
          <ExplorerCard chain="lasna" event={proof?.reactive} description={`Settlement decision on ${CHAIN_LABELS.lasna}`} />
          <ExplorerCard chain={chainKeys.asset} event={proof?.assetLocked} description={`Asset locked on ${CHAIN_LABELS[chainKeys.asset]}`} />
        </div>
      </div>

      <HopTimeline order={order} proof={proof} />
    </div>
  )
}

export default function VerifyPage() {
  const { orderId: param } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(param ?? '')
  const [localError, setLocalError] = useState<string | null>(null)
  const orderId = normalizeOrderId(param)

  useEffect(() => {
    setInput(param ?? '')
    setLocalError(null)
  }, [param])

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeOrderId(input)
    if (!normalized) {
      setLocalError('Enter an order ID: 64 hex characters, with or without 0x.')
      return
    }
    setLocalError(null)
    navigate(`/verify/${normalized}`)
  }

  const malformed = !!param && !orderId

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-ink-900">Track an order</h1>
        <p className="mt-1 text-xs text-ink-500">Follow a trade across all three chains. No wallet needed.</p>
      </div>

      <Panel title="Find an order">
        <form onSubmit={submit} className="flex flex-wrap gap-3">
          <input
            className={`${inputClass} min-w-0 flex-1 sm:min-w-[280px]`}
            placeholder="Paste an order ID — 0x… or 64 hex characters"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
          <Button variant="primary" type="submit" icon={<Search {...icon} />}>Track order</Button>
        </form>
        {(localError || malformed) && (
          <p className="mt-3 text-xs text-bad">{localError ?? 'That order ID is not valid. Check it and try again.'}</p>
        )}
      </Panel>

      {!param ? (
        <EmptyState title="Enter an order ID" message="Paste an ID above to see the settlement trail." />
      ) : !orderId ? null : (
        <VerifyDetail orderId={orderId} />
      )}
    </div>
  )
}
