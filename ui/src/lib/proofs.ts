import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { CHAIN_IDS, CHAIN_LABELS, EXPLORER_NAMES, txUrl, type ChainKey } from './chains'

import { formatTimestamp, isZeroAddress, truncate } from './format'
import { logClient, resolveProof, type ProofChainKeys, type ProofClients } from './logs'
import { useMarket, useMarketConfig } from './markets'
import { useOrder } from './queries'
import { isOrderTerminal } from './status'
import type { Order, ProofData, ProofEvent } from './types'

export function useProofClients(): ProofClients {
  const { chainKeyFor } = useMarket()
  const lasna = usePublicClient({ chainId: CHAIN_IDS.lasna })
  const payment = usePublicClient({ chainId: CHAIN_IDS[chainKeyFor('payment')] })
  const asset = usePublicClient({ chainId: CHAIN_IDS[chainKeyFor('asset')] })
  return { lasna: logClient(lasna), payment: logClient(payment), asset: logClient(asset) }
}

/**
 * One cached proof query per order, shared by order detail, verify, raw state
 * and My Orders (identical queryKey). Polling only happens while the order can
 * still change: terminal orders keep their already-observed hashes forever
 * with `staleTime: Infinity` and `refetchInterval: false`.
 */
export function useProof(orderId?: Hex | null, providedOrder?: Order | null) {
  const config = useMarketConfig()
  const { market, chainKeyFor } = useMarket()
  const clients = useProofClients()
  // Callers that already have the order (e.g. My Orders) pass it through so we
  // do not create a second getOrder poller for the same id.
  const orderQuery = useOrder(orderId, { enabled: !providedOrder })
  const order = providedOrder ?? orderQuery.data
  const terminal = isOrderTerminal(order)
  const watch = `${market.id}:${config.reactive.reactiveContract}:${config.base.paymentEscrow}:${config.unichain.assetEscrow}`
  const queryKey = ['proof', market.id, orderId, watch] as const
  // Wait for getOrder: its deadline is what makes the log window narrow.
  // Starting the proof with an unknown order would fall back to the global
  // deployment-wide scan (the old ~90-call behaviour).
  const orderResolved = !!providedOrder || orderQuery.isSuccess || orderQuery.isError

  return useQuery({
    queryKey,
    enabled: !!orderId && orderResolved && !!order,
    // 8s while pending (inside the requested 5–10s band), never when settled.
    refetchInterval: terminal ? false : 8_000,
    staleTime: terminal ? Infinity : 8_000,
    queryFn: async (context): Promise<ProofData> => {
      const previous = context.client.getQueryData<ProofData>(queryKey)
      return resolveProof(orderId!, config, clients, order, previous, {
        payment: chainKeyFor('payment'),
        asset: chainKeyFor('asset'),
      })
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
  chainKeys: ProofChainKeys = { payment: 'base', asset: 'unichain' },
): HopStep[] {
  const refundMode = !!order?.refundRequested || !!proof?.paymentRefunded || !!proof?.assetRefunded
  const open = !!order && isZeroAddress(order.seller)
  const paymentTitle = refundMode
    ? 'Payment refunded'
    : open
      ? 'Payment to winner'
      : 'Payment released'
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
    {
      n: '03',
      key: 'reactive',
      title: 'Settlement decision',
      chain: 'lasna',
      event: proof?.reactive,
    },
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
  chainKeys: ProofChainKeys = { payment: 'base', asset: 'unichain' },
): string {
  const hops = buildHops(order, proof, chainKeys)
  const lines = [
    `# Handshake settlement proof — \`${orderId}\``,
    '',
    'Trust-minimized cross-chain OTC settlement · Reactive Omni arbiter',
    '',
    '| Hop | Chain | Transaction hash | Block / time | Explorer |',
    '| --- | --- | --- | --- | --- |',
    ...hops.map(markdownRow),
    '',
    '## Observed terms',
    '',
    `- Buyer: \`${order?.buyer ?? '—'}\``,
    `- Seller: \`${order?.seller ?? '—'}\``,
    `- Payment: ${order?.paymentAmount?.toString() ?? '—'} (${CHAIN_LABELS[chainKeys.payment]})`,
    `- Asset: ${order?.assetAmount?.toString() ?? '—'} (${CHAIN_LABELS[chainKeys.asset]})`,
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
