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
import { EXPLORER_NAMES, txUrl, CHAIN_LABELS } from '../lib/chains'
import { useConfig } from '../lib/config'
import { countdown, formatAmount, formatDeadline, normalizeOrderId, truncate } from '../lib/format'
import { useProof } from '../lib/proofs'
import { useOrder } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import { useTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'
import type { ChainKey } from '../lib/chains'
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
          <ExternalLink href={txUrl(chain, event.txHash)}>{truncate(event.txHash, 12, 10)}</ExternalLink>
        ) : (
          <span className="font-sans text-ink-400">Settlement in progress</span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-400">{description}</p>
    </div>
  )
}

export default function VerifyPage() {
  const { orderId: param } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(param ?? '')
  const [localError, setLocalError] = useState<string | null>(null)
  const config = useConfig()
  const now = useNow()
  const paymentToken = useTokenDisplay('payment')
  const assetToken = useTokenDisplay('asset')

  useEffect(() => {
    setInput(param ?? '')
    setLocalError(null)
  }, [param])

  const orderId = normalizeOrderId(param)
  const orderQuery = useOrder(orderId)
  const proofQuery = useProof(orderId)
  const order = orderQuery.data
  const proof = proofQuery.data
  const status = order ? deriveStatus(order, now) : null

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

  const configured = !!config.reactive.reactiveContract
  const notFound = param && !orderQuery.isLoading && !order
  const malformed = !!param && !orderId
  const paymentSymbol = paymentToken.symbol
  const assetSymbol = assetToken.symbol
  const paymentDecimals = paymentToken.decimals
  const assetDecimals = assetToken.decimals

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-ink-900">Track an order</h1>
        <p className="mt-1 text-xs text-ink-500">Follow a trade across all three chains. No wallet needed.</p>
      </div>

      <Panel title="Find an order">
        <form onSubmit={submit} className="flex flex-wrap gap-3">
          <input
            className={`${inputClass} min-w-[280px] flex-1`}
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
        {!configured && (
          <p className="mt-3 text-xs text-ink-500">Order lookup is unavailable in this workspace.</p>
        )}
      </Panel>

      {!param ? (
        <EmptyState title="Enter an order ID" message="Paste an ID above to see the settlement trail." />
      ) : !orderId ? null : orderQuery.isLoading ? (
        <Panel>
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
            <Spinner /> Loading order
          </div>
        </Panel>
      ) : notFound ? (
        <EmptyState title="No order found" message="Check the order ID and try again." />
      ) : (
        <div className="space-y-6">
          <Panel
            title={`Order ${truncate(orderId, 12, 8)}`}
            subtitle="Terms read from the reactive contract"
            action={status && <StatusPill status={status} />}
          >
            <TradeTicket
              pay={{
                symbol: paymentSymbol,
                chain: 'base',
                kind: 'payment',
                mark: paymentToken.mark,
                color: paymentToken.color,
                amount: formatAmount(order?.paymentAmount, paymentDecimals),
                hint: `You pay · ${CHAIN_LABELS.base}`,
              }}
              receive={{
                symbol: assetSymbol,
                chain: 'unichain',
                kind: 'asset',
                mark: assetToken.mark,
                color: assetToken.color,
                amount: formatAmount(order?.assetAmount, assetDecimals),
                hint: `You receive · ${CHAIN_LABELS.unichain}`,
              }}
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Buyer" value={truncate(order?.buyer, 8, 6)} />
              <Metric label="Seller" value={truncate(order?.seller, 8, 6)} />
              <Metric label="Deadline" value={formatDeadline(order?.deadline ?? null)} />
              <Metric label="Time remaining" value={countdown(order?.deadline ?? null, now)} />
            </div>
          </Panel>

          <div>
            <h2 className="mb-3 text-sm font-medium text-ink-900">Explorers</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <ExplorerCard chain="base" event={proof?.paymentLocked} description={`Payment locked on ${CHAIN_LABELS.base}`} />
              <ExplorerCard chain="lasna" event={proof?.reactive} description={`Settlement decision on ${CHAIN_LABELS.lasna}`} />
              <ExplorerCard chain="unichain" event={proof?.assetLocked} description={`Asset locked on ${CHAIN_LABELS.unichain}`} />
            </div>
          </div>

          <HopTimeline order={order} proof={proof} />
        </div>
      )}
    </div>
  )
}
