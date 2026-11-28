import { useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import {
  CHAIN_IDS,
  CHAIN_LABELS,
  EXPLORER_NAMES,
  chainKeyFromId,
  tradingChainKeyFromId,
  txUrl,
  type ChainKey,
  type TradingChainKey,
} from './chains'
import { formatTimestamp, isZeroAddress, truncate } from './format'
import { logClient, type ProofChainKeys, type ProofClients } from './logs'
import { displayRefundReason, refundEvidence } from './status'
import { useOrderDetail } from './apiQueries'
import type { ApiTimelineEvent } from './api'
import type { Order, ProofData, ProofEvent, ProofEventKind } from './types'

/** All three EVM clients are fixed hook slots; each call picks by venue. */
export function useProofClients(payment?: TradingChainKey, asset?: TradingChainKey): ProofClients & {
  byChain: Record<TradingChainKey, ReturnType<typeof logClient>>
} {
  const base = logClient(usePublicClient({ chainId: CHAIN_IDS.base }))
  const unichain = logClient(usePublicClient({ chainId: CHAIN_IDS.unichain }))
  const sepolia = logClient(usePublicClient({ chainId: CHAIN_IDS.sepolia }))
  const lasna = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const byChain = { base, unichain, sepolia }
  return {
    lasna,
    payment: payment ? byChain[payment] : null,
    asset: asset ? byChain[asset] : null,
    byChain,
  }
}

/** Chain keys for an order come only from its own per-order venue tuple. */
export function orderChainKeys(order?: Order | null): ProofChainKeys {
  if (!order) return { payment: 'base', asset: 'unichain' }
  return {
    payment: tradingChainKeyFromId(order.venue.paymentChainId) ?? 'base',
    asset: tradingChainKeyFromId(order.venue.assetChainId) ?? 'unichain',
  }
}

const KIND_BY_STAGE: Record<string, ProofEventKind> = {
  // Stages as emitted by the public API indexer (camelCase).
  paymentLocked: 'paymentLocked',
  assetLocked: 'assetLocked',
  orderStateChanged: 'reactive',
  callbackRequest: 'callbackRequest',
  paymentReleased: 'paymentReleased',
  assetReleased: 'assetReleased',
  paymentRefunded: 'paymentRefunded',
  assetRefunded: 'assetRefunded',
  cron100: 'cron100',
  // Legacy on-chain log names, kept for older cached payloads.
  PaymentLocked: 'paymentLocked',
  'lock.payment': 'paymentLocked',
  AssetLocked: 'assetLocked',
  'lock.asset': 'assetLocked',
  OrderStateChanged: 'reactive',
  'order.state': 'reactive',
  CallbackRequest: 'callbackRequest',
  'callback.requested': 'callbackRequest',
  PaymentReleased: 'paymentReleased',
  AssetReleased: 'assetReleased',
  PaymentRefunded: 'paymentRefunded',
  AssetRefunded: 'assetRefunded',
  Cron100: 'cron100',
  // Live Cron10 ticks are legacy events: keep them in their own kind so a
  // support bundle never exports one as the post-cutover `cron100` topic.
  cron10: 'cron10',
  Cron10: 'cron10',
}

function kindForStage(stage: string, payload: Record<string, unknown>): ProofEventKind | null {
  const direct = KIND_BY_STAGE[stage]
  if (direct) return direct
  if (stage === 'terminal.release' || stage === 'terminal.refund') {
    const asset = payload.leg === 'asset'
    if (stage === 'terminal.release') return asset ? 'assetReleased' : 'paymentReleased'
    return asset ? 'assetRefunded' : 'paymentRefunded'
  }
  return null
}

/** API-derived timeline replaces the old 8s `eth_getLogs` proof scans. */
export function proofFromTimeline(orderId: string, timeline: ApiTimelineEvent[]): ProofData {
  // Unknown stages are dropped rather than mislabelled as the settlement decision.
  const events: ProofEvent[] = timeline.flatMap((entry, index) => {
    const kind = kindForStage(entry.stage, entry.payload ?? {})
    if (!kind) return []
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(entry.payload ?? {})) {
      if (value === null || value === undefined) continue
      fields[key] = typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
    const nonceValue = entry.payload?.nonce
    return {
      id: `${entry.txHash}-${entry.logIndex}-${index}`,
      kind,
      chain: chainKeyFromId(entry.chainId) ?? 'lasna',
      txHash: entry.txHash as Hex,
      blockNumber: BigInt(entry.blockNumber || 0),
      logIndex: entry.logIndex || 0,
      timestamp: Number.isFinite(Date.parse(entry.at)) ? Math.floor(Date.parse(entry.at) / 1000) : null,
      fields,
      ...(nonceValue !== undefined ? { nonce: BigInt(String(nonceValue)) } : {}),
    }
  })
  const first = (kind: ProofEventKind) => events.find((event) => event.kind === kind)
  // Only an actual decision counts. CREATED / PAYMENT_SEEN etc. are also
  // `orderStateChanged` events but must not be shown as the decision hash.
  const decision = events.find((event) =>
    event.kind === 'reactive'
    && (event.fields?.stage === 'SETTLE_REQUESTED' || event.fields?.stage === 'REFUND_REQUESTED'));
  const zero = 0n
  return {
    orderId: orderId as Hex,
    events,
    paymentLocked: first('paymentLocked'),
    assetLocked: first('assetLocked'),
    reactive: decision,
    paymentReleased: first('paymentReleased'),
    assetReleased: first('assetReleased'),
    paymentRefunded: first('paymentRefunded'),
    assetRefunded: first('assetRefunded'),
    scan: { lasnaFrom: zero, paymentFrom: zero, assetFrom: zero, to: zero },
  }
}

export function useProof(orderId?: Hex | null, _providedOrder?: Order | null) {
  const detail = useOrderDetail(orderId)
  const data = useMemo(
    () => (detail.data && orderId ? proofFromTimeline(String(orderId), detail.data.timeline) : null),
    [detail.data, orderId],
  )
  return { data, isLoading: detail.isLoading, isError: detail.isError, refetch: detail.refetch }
}

export interface HopStep {
  n: string
  key: string
  title: string
  chain: ChainKey
  event?: ProofEvent
  note?: string
}

export function buildHops(
  order: Order | null | undefined,
  proof?: ProofData | null,
  chainKeys: ProofChainKeys = orderChainKeys(order),
): HopStep[] {
  const refundMode = !!order?.refundRequested || !!proof?.paymentRefunded || !!proof?.assetRefunded
  const open = !!order && isZeroAddress(order.seller)
  const paymentTitle = refundMode ? 'Payment refunded' : open ? 'Payment to winner' : 'Payment released'
  const closing: Array<[string, string, ChainKey, ProofEvent | undefined]> = refundMode
    ? [
        ['paymentRefund', paymentTitle, chainKeys.payment, proof?.paymentRefunded],
        ['assetRefund', 'Asset refunded', chainKeys.asset, proof?.assetRefunded],
      ]
    : [
        ['paymentRelease', paymentTitle, chainKeys.payment, proof?.paymentReleased],
        ['assetRelease', 'Asset released', chainKeys.asset, proof?.assetReleased],
      ]

  return [
    { n: '01', key: 'paymentLocked', title: 'Payment locked', chain: chainKeys.payment, event: proof?.paymentLocked },
    { n: '02', key: 'assetLocked', title: open ? 'Asset locked by winner' : 'Asset locked', chain: chainKeys.asset, event: proof?.assetLocked },
    { n: '03', key: 'reactive', title: 'Settlement decision', chain: 'lasna', event: proof?.reactive },
    ...closing.map(([key, title, chain, event], i) => ({
      n: i === 0 ? '04' : '05',
      key,
      title,
      chain,
      event,
    })),
  ]
}

function markdownRow(step: HopStep): string {
  const hash = step.event?.txHash
  const url = txUrl(step.chain, hash)
  const hashCell = hash ? `\`${hash}\`` : '—'
  const explorerCell = url ? `[${EXPLORER_NAMES[step.chain]}](${url})` : '—'
  const block = step.event ? `${step.event.blockNumber.toString()} @ ${formatTimestamp(step.event.timestamp)}` : '—'
  return `| ${step.n} ${step.title} | ${CHAIN_LABELS[step.chain]} | ${hashCell} | ${block} | ${explorerCell} |`
}

export function buildProofMarkdown(
  orderId: Hex,
  order: Order | null | undefined,
  proof: ProofData | null | undefined,
  chainKeys: ProofChainKeys = orderChainKeys(order),
): string {
  const hops = buildHops(order, proof, chainKeys)
  const lines = [
    `# Handshake settlement proof — \`${orderId}\``,
    '',
    'Trust-minimized cross-chain OTC settlement · one reactive arbiter',
    '',
    '| Hop | Chain | Transaction hash | Block / time | Explorer |',
    '| --- | --- | --- | --- | --- |',
    ...hops.map(markdownRow),
    '',
    '## Observed terms and venue',
    '',
    `- Buyer: \`${order?.buyer ?? '—'}\``,
    `- Seller: \`${order?.seller ?? '—'}\``,
    `- Payment: ${order?.paymentAmount?.toString() ?? '—'} (${CHAIN_LABELS[chainKeys.payment]})`,
    `- Asset: ${order?.assetAmount?.toString() ?? '—'} (${CHAIN_LABELS[chainKeys.asset]})`,
    `- Payment escrow: \`${order?.venue.paymentEscrow ?? '—'}\``,
    `- Asset escrow: \`${order?.venue.assetEscrow ?? '—'}\``,
    `- Deadline: \`${order?.deadline?.toString() ?? '—'}\``,
    `- RC nonce: \`${order?.nonce?.toString() ?? '—'}\``,
    '',
    'Proof assembled from public on-chain logs — no hash is shown unless it was observed.',
  ]
  return lines.join('\n')
}

/**
 * Read-only support bundle for a stranded order: identifiers, venue, terms and
 * every hash actually observed in the public timeline. Never invents a hash.
 */
export function buildCaseDetailsText(
  orderId: string,
  order: Order | null | undefined,
  proof: ProofData | null | undefined,
  chainKeys: ProofChainKeys = orderChainKeys(order),
): string {
  const observed = (proof?.events ?? []).map(
    (event) => `- ${event.kind} · ${CHAIN_LABELS[event.chain]} · ${event.txHash}`,
  )
  // A stale reason on a matched order is not a refund claim. Export only the
  // filtered reason, and let legacy cron10 events keep their own kind.
  const shownReason = displayRefundReason(order?.refundReason, refundEvidence(order, proof))
  return [
    `Handshake case details — ${orderId}`,
    '',
    `Order ID: ${orderId}`,
    `Venue: payment ${CHAIN_LABELS[chainKeys.payment]} (${order?.venue.paymentEscrow ?? '—'}) · asset ${CHAIN_LABELS[chainKeys.asset]} (${order?.venue.assetEscrow ?? '—'})`,
    `Terms hash: ${order?.termsHash ?? '—'}`,
    `Refund reason: ${shownReason ?? '—'}`,
    `Buyer: ${order?.buyer ?? '—'}`,
    `Seller: ${order?.seller ?? '—'}`,
    'Observed transactions:',
    ...(observed.length ? observed : ['- none observed in the public index']),
    '',
    'Copied from the public order tracker. Include this bundle when asking for support.',
  ].join('\n')
}

/** Small hook used by copy buttons across screens. */
export function useCopyFeedback() {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  return { copied, setCopied }
}

export function shortProofSummary(proof?: ProofData | null): string {
  if (!proof) return 'Settlement in progress'
  const hashes = proof.events.map((e) => truncate(e.txHash, 8, 6))
  return hashes.length ? hashes.join(' · ') : 'Settlement in progress'
}
