import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import HopTimeline from '../components/HopTimeline'
import { CopyButton, EmptyState, ExternalLink, Metric, Panel, Spinner, StatusPill } from '../components/ui'
import { EXPLORER_NAMES, txUrl } from '../lib/chains'
import { useConfig } from '../lib/config'
import { countdown, formatAmount, formatDeadline, normalizeOrderId, truncate } from '../lib/format'
import { buildProofMarkdown, useProof } from '../lib/proofs'
import { useOrder, useTokenMeta } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import type { ProofEvent } from '../lib/types'
import { useNow } from '../lib/useNow'
import type { ChainKey } from '../lib/chains'

interface ExplorerCardProps {
  chain: ChainKey
  event?: ProofEvent | null
  description: string
}

function ExplorerCard({ chain, event, description }: ExplorerCardProps) {
  const url = txUrl(chain, event?.txHash)
  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-850/50 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-100">{EXPLORER_NAMES[chain]}</span>
        <span className="font-mono text-[10px] text-slate-500">{chain === 'base' ? 'Base Sepolia' : chain === 'lasna' ? 'Lasna' : 'Unichain Sepolia'}</span>
      </div>
      {event ? (
        <>
          <ExternalLink href={url} className="break-all font-mono text-[11px]">{event.txHash}</ExternalLink>
          <p className="mt-2 text-[10px] text-slate-500">
            {description} · block #{event.blockNumber.toString()}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-slate-600">— not observed yet</p>
      )}
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
  const paymentMeta = useTokenMeta('payment')
  const assetMeta = useTokenMeta('asset')

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
  const markdown = buildProofMarkdown(orderId ?? '0x', order, proof)

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeOrderId(input)
    if (!normalized) {
      setLocalError('Enter a valid order ID: 64 hex characters, with or without 0x.')
      return
    }
    setLocalError(null)
    navigate(`/verify/${normalized}`)
  }

  const configured = !!config.reactive.reactiveContract
  const notFound = param && !orderQuery.isLoading && !order
  const malformed = !!param && !orderId

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-50">Public verification</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          Paste any order ID to reconstruct the full three-chain settlement from public logs. No wallet, no backend, no trust in this dashboard — open the explorer links and check each hop yourself.
        </p>
      </div>

      <Panel title="Look up an order" subtitle="Read-only by design. Works even when contracts are in debt.">
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input
            className="min-w-[280px] flex-1 rounded-lg border border-white/10 bg-ink-950/70 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-reactive/60 focus:ring-1 focus:ring-reactive/30"
            placeholder="Paste order ID — 0x… or 64 hex characters"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
          <button type="submit" className="rounded-lg bg-gradient-to-r from-reactive to-payment px-5 py-2 text-xs font-bold text-ink-950 transition hover:brightness-110">
            Verify
          </button>
        </form>
        {(localError || malformed) && (
          <p className="mt-3 text-xs text-red-300">
            {localError ?? 'Malformed order ID. '}
            <Link to="/orders" className="ml-1 underline">Back to order board</Link>
          </p>
        )}
        {!configured && (
          <p className="mt-3 text-xs text-warn">
            RC address is not configured yet — set it in public/contracts.json to enable on-chain lookups.
          </p>
        )}
      </Panel>

      {!param ? (
        <EmptyState
          title="No order ID supplied"
          message="Enter an ID above, or open a shareable /verify/0x… link from the order board or demo video description."
        />
      ) : !orderId ? null : orderQuery.isLoading ? (
        <Panel><div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500"><Spinner /> Reading getOrder(id) on Lasna…</div></Panel>
      ) : notFound ? (
        <EmptyState
          title={configured ? 'No order found on Lasna for this ID' : 'RC address not configured'}
          message="getOrder(id) returned no order. Check the ID or browse the order board; nothing is fabricated here."
          action={<Link to="/orders" className="text-xs text-payment underline">Back to order board</Link>}
        />
      ) : (
        <div className="space-y-5 animate-slide-in">
          <Panel
            title={`Order ${truncate(orderId, 12, 8)}`}
            subtitle="Terms read from the reactive contract on Lasna"
            action={
              <div className="flex flex-wrap items-center gap-2">
                {status && <StatusPill status={status} />}
                <CopyButton text={markdown} label="Copy proof markdown" />
              </div>
            }
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Buyer" value={truncate(order?.buyer, 8, 6)} />
              <Metric label="Seller" value={truncate(order?.seller, 8, 6)} />
              <Metric label="Payment leg" value={formatAmount(order?.paymentAmount, paymentMeta.data?.decimals ?? 6, paymentMeta.data?.symbol)} hint="Base Sepolia" />
              <Metric label="Asset leg" value={formatAmount(order?.assetAmount, assetMeta.data?.decimals ?? 18, assetMeta.data?.symbol)} hint="Unichain Sepolia" />
              <Metric label="Deadline" value={countdown(order?.deadline ?? null, now)} hint={formatDeadline(order?.deadline ?? null)} />
              <Metric label="Nonce" value={order?.nonce?.toString() ?? '—'} />
              <Metric label="Legs closed" value={`${order?.paymentClosed ? '✓' : '·'} payment / ${order?.assetClosed ? '✓' : '·'} asset`} />
              <Metric label="Hash resolution" value={proofQuery.isFetching ? 'scanning…' : `${proof?.events.length ?? 0} events`} hint={`from block ${proof?.scan.baseFrom.toString() ?? '—'} (Base)`} />
            </div>
          </Panel>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">The three explorer links</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <ExplorerCard chain="base" event={proof?.paymentLocked} description="PaymentLocked on Base" />
              <ExplorerCard chain="lasna" event={proof?.reactive} description="CallbackRequest on Lasna" />
              <ExplorerCard chain="unichain" event={proof?.assetLocked} description="AssetLocked on Unichain" />
            </div>
            <p className="mt-2 text-[10px] text-slate-600">
              Callback transactions on the destination chains appear in the timeline below as soon as their logs land.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]">
            <Panel title="Proof markdown" subtitle="Paste this table into the DoraHacks submission form">
              <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-ink-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {markdown}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton text={markdown} label="Copy proof markdown" />
                <Link to={`/orders/${orderId}`} className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.08]">
                  Operator detail →
                </Link>
              </div>
            </Panel>
            <HopTimeline order={order} proof={proof} orderId={orderId} />
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-slate-600">
        Verify reads only. Wallet connection is never required on this page.
      </p>
    </div>
  )
}
