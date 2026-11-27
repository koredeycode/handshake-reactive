import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import {
  CHAIN_IDS,
  CHAIN_LABELS,
  EXPLORER_NAMES,
  txUrl,
  type ChainKey,
  type TradingChainKey,
} from './chains'
import { tradingChainKeyFromId } from './chains'
import { configuredAddress, useConfig } from './config'
import { formatTimestamp, isZeroAddress, truncate } from './format'
import { logClient, proofVenue, resolveProof, type ProofChainKeys, type ProofClients } from './logs'
import { useOrder } from './queries'
import { isOrderTerminal } from './status'
import type { Order, ProofData, ProofEvent } from './types'

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

/**
 * One cached proof query per order + venue, shared by detail, verify, raw
 * state and My Orders. Polling only while the order can still change; a
 * settled order keeps its hashes with staleTime Infinity and no refetch.
 */
export function useProof(orderId?: Hex | null, providedOrder?: Order | null) {
  const config = useConfig()
  const rc = configuredAddress(config.reactive.reactiveContract)
  const orderQuery = useOrder(orderId, { enabled: !providedOrder })
  const order = providedOrder ?? orderQuery.data
  const terminal = isOrderTerminal(order)
  const keys = orderChainKeys(order)
  const venue = order ? proofVenue(order.venue, config) : null
  const venueKey = order
    ? `${order.venue.paymentChainId}:${order.venue.paymentEscrow}:${order.venue.assetChainId}:${order.venue.assetEscrow}`
    : 'unknown'
  const queryKey = ['proof', rc, orderId, venueKey] as const
  const orderResolved = !!providedOrder || orderQuery.isSuccess || orderQuery.isError
  const clients = useProofClients(keys.payment, keys.asset)

  return useQuery({
    queryKey,
    enabled: !!orderId && orderResolved && !!order && !!venue,
    refetchInterval: terminal ? false : 8_000,
    staleTime: terminal ? Infinity : 8_000,
    queryFn: async (context): Promise<ProofData> => {
      const previous = context.client.getQueryData<ProofData>(queryKey)
      return resolveProof(orderId!, config, clients, order, previous, venue!)
    },
  })
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
