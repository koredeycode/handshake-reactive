import type { Hex } from 'viem'
import { CHAIN_LABELS, addressUrl, type ChainKey } from '../lib/chains'
import { isZeroAddress, truncate } from '../lib/format'
import { buildHops, buildProofMarkdown, orderChainKeys } from '../lib/proofs'
import type { ProofChainKeys } from '../lib/logs'
import { displayRefundReason, refundEvidence, refundReasonKey, refundReasonLabel, refundReasonSentence } from '../lib/status'
import { ChainMark, ChainPill, ConvergenceMark, CopyButton, ExternalLink, Notice, Panel, TxLink } from './ui'
import type { Order, ProofData } from '../lib/types'

function pendingText(key: string): string {
  if (key === 'paymentLocked' || key === 'assetLocked') return 'Awaiting this leg'
  if (key === 'reactive') return 'Waiting for the other leg'
  return 'Settlement in progress'
}

/** One row in the flow: chain logo, plain-language label, and a real tx link when observed. */
function FlowRow({
  chain,
  label,
  event,
}: {
  chain: ChainKey
  label: string
  event?: { txHash: string }
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2 rounded-xl border border-line bg-paper-0 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="flex min-w-0 items-start gap-2">
        <ChainMark chain={chain} className="mt-0.5 h-4 w-4" />
        <span className="text-[12px] leading-snug text-ink-700">{label}</span>
      </span>
      {event ? (
        <TxLink
          chain={chain}
          hash={event.txHash}
          label={truncate(event.txHash, 6, 4)}
          className="max-w-[9rem] truncate"
        />
      ) : (
        <span className="shrink-0 font-sans text-[12px] text-ink-400">Pending</span>
      )}
    </div>
  )
}

/** Three columns: locked on two chains → one decision → delivered on two chains. */
function ConvergenceDiagram({
  proof,
  order,
  chainKeys,
}: {
  proof?: ProofData | null
  order?: Order | null
  chainKeys: ProofChainKeys
}) {
  const refundMode = !!proof?.paymentRefunded || !!proof?.assetRefunded
  const open = !!order && isZeroAddress(order.seller)
  const paymentLabel = CHAIN_LABELS[chainKeys.payment]
  const assetLabel = CHAIN_LABELS[chainKeys.asset]
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-line bg-paper-50 p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-4">
      <div className="min-w-0 space-y-2">
        <p className="px-1 text-[12px] font-medium text-ink-500">Locked on origin chains</p>
        <FlowRow chain={chainKeys.payment} label={`Payment · ${paymentLabel}`} event={proof?.paymentLocked} />
        <FlowRow chain={chainKeys.asset} label={`Asset · ${assetLabel}`} event={proof?.assetLocked} />
      </div>

      <div className="flex min-w-0 items-center justify-center gap-3 md:flex-col md:gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/25 bg-accent-soft text-accent">
          <ConvergenceMark className="h-5 w-5" />
        </span>
        <span className="text-[12px] font-medium text-ink-700">One decision</span>
        <ChainMark chain="lasna" className="h-4 w-4" />
        <span className="text-[11px] text-ink-400">{CHAIN_LABELS.lasna}</span>
        {proof?.reactive ? (
          <TxLink
            chain="lasna"
            hash={proof.reactive.txHash}
            label={truncate(proof.reactive.txHash, 6, 4)}
            className="max-w-[9rem] truncate"
          />
        ) : null}
      </div>

      <div className="min-w-0 space-y-2">
        <p className="px-1 text-[12px] font-medium text-ink-500">
          {refundMode ? 'Refunded to depositors' : 'Delivered by callback'}
        </p>
        <FlowRow
          chain={chainKeys.payment}
          label={
            refundMode
              ? `Payment back to buyer · ${paymentLabel}`
              : `Payment to ${open ? 'winner' : 'seller'} · ${paymentLabel}`
          }
          event={refundMode ? proof?.paymentRefunded : proof?.paymentReleased}
        />
        <FlowRow
          chain={chainKeys.asset}
          label={
            refundMode ? `Asset back to seller · ${assetLabel}` : `Asset to buyer · ${assetLabel}`
          }
          event={refundMode ? proof?.assetRefunded : proof?.assetReleased}
        />
      </div>
    </div>
  )
}

export default function HopTimeline({
  order,
  proof,
  reason,
}: {
  order?: Order | null
  proof?: ProofData | null
  reason?: string | null
}) {
  const chainKeys: ProofChainKeys = orderChainKeys(order)
  const hops = buildHops(order, proof, chainKeys)
  const done = hops.filter((hop) => hop.event).length
  // A persisted reason alone is not proof of a refund — historical rows carry
  // `race_loser` on healthy matched orders. Filter through the shared helper.
  const shownReason = displayRefundReason(reason, refundEvidence(order, proof))
  const reasonKey = refundReasonKey(shownReason)
  const reasonLabel = refundReasonLabel(shownReason)
  const winnerKnown = !!order?.winner && !isZeroAddress(order.winner)
  const bothLegsSeen = !!order?.paymentSeen && !!order?.assetSeen
  const refundHash = proof?.assetRefunded?.txHash ?? proof?.paymentRefunded?.txHash
  const proofMarkdown = buildProofMarkdown(proof?.orderId ?? ('0x' as Hex), order, proof, chainKeys)

  return (
    <Panel
      title="Settlement trail"
      subtitle={`Two legs, one decision, two releases${reasonLabel ? ` · ${reasonLabel}` : ''}`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {reasonLabel && (
            <span
              title={refundReasonSentence(shownReason) ?? undefined}
              className="rounded-full border border-warn/25 bg-warn-soft px-2 py-0.5 text-[10px] text-warn"
            >
              {reasonLabel}
            </span>
          )}
          <span aria-live="polite" className="tnum font-mono text-[11px] text-ink-400">
            {done} of {hops.length} observed
          </span>
          <CopyButton text={proofMarkdown} label="Copy proof bundle" />
        </div>
      }
    >
      <ConvergenceDiagram proof={proof} order={order} chainKeys={chainKeys} />

      <p className="mb-4 text-[11px] leading-relaxed text-ink-400">
        Both callbacks are requested in one Lasna transaction. The two origin chains can show their release rows a second or two apart — wait for both before treating the trade as final.
      </p>

      {reasonKey === 'race_loser' && (
        <Notice className="mb-5" title="You lost this race — your asset was returned">
          <span>
            Another seller locked the asset first and won the order. Your tASSET was refunded automatically on {CHAIN_LABELS[chainKeys.asset]}.
          </span>
          {winnerKnown && (
            <span>
              {' '}Winner:{' '}
              <ExternalLink href={addressUrl(chainKeys.asset, order!.winner)} className="text-[11px]">
                {truncate(order!.winner, 8, 6)}
              </ExternalLink>
              .
            </span>
          )}
          {refundHash && (
            <span>
              {' '}Refund: <TxLink chain={chainKeys.asset} hash={refundHash} />.
            </span>
          )}
        </Notice>
      )}

      {reasonKey === 'late' && (
        <Notice className="mb-5" title="Your lock arrived too late — it was refunded">
          <span>
            The order was already settled or refunded when your lock reached the escrow, so the reactive contract returned it automatically on {CHAIN_LABELS[chainKeys.asset]}.
          </span>
          {refundHash && (
            <span>
              {' '}Refund: <TxLink chain={chainKeys.asset} hash={refundHash} />.
            </span>
          )}
        </Notice>
      )}

      <ol className="relative">
        {hops.map((hop, i) => {
          const event = hop.event
          const decision = hop.key === 'reactive'
          const last = i === hops.length - 1
          return (
            <li key={hop.key} className={`relative flex gap-4 ${last ? '' : 'pb-6'}`}>
              {!last && <span className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-line" />}
              <div className="relative z-10 shrink-0">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-xl border ${
                    event ? 'border-accent/25 bg-accent-soft text-accent' : 'border-line bg-paper-50 text-ink-400'
                  }`}
                >
                  {decision ? (
                    <ConvergenceMark className="h-4 w-4" />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${event ? 'bg-accent' : 'bg-ink-400'}`} />
                  )}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tnum font-mono text-[11px] text-ink-400">{hop.n}</span>
                  <span className={`text-[13px] font-medium ${event ? 'text-ink-900' : 'text-ink-500'}`}>
                    {hop.title}
                  </span>
                  <ChainPill chain={hop.chain} />
                </div>
                <div className="min-w-0 font-mono text-[11px]">
                  {event ? (
                    <TxLink
                      chain={hop.chain}
                      hash={event.txHash}
                      label={truncate(event.txHash, 6, 4)}
                      className="max-w-[9rem] truncate"
                    />
                  ) : (
                    <span className="font-sans text-[12px] text-ink-400">
                      {decision && bothLegsSeen ? 'Decision in flight — waiting for callback' : pendingText(hop.key)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
