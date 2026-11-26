import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { CHAIN_IDS, EXPLORER_NAMES, txUrl } from './chains'
import { useConfig } from './config'
import { formatTimestamp, truncate } from './format'
import { logClient, resolveProof, type ProofClients } from './logs'
import { useOrder } from './queries'
import { isOrderTerminal } from './status'
import type { Order, ProofData, ProofEvent } from './types'

export function useProofClients(): ProofClients {
  const lasna = usePublicClient({ chainId: CHAIN_IDS.lasna })
  const base = usePublicClient({ chainId: CHAIN_IDS.base })
  const unichain = usePublicClient({ chainId: CHAIN_IDS.unichain })
  return { lasna: logClient(lasna), base: logClient(base), unichain: logClient(unichain) }
}

/**
 * One cached proof query per order, shared by order detail, verify, raw state
 * and My Orders (identical queryKey). Polling only happens while the order can
 * still change: terminal orders keep their already-observed hashes forever
 * with `staleTime: Infinity` and `refetchInterval: false`.
 */
export function useProof(orderId?: Hex | null, providedOrder?: Order | null) {
  const config = useConfig()
  const clients = useProofClients()
  // Callers that already have the order (e.g. My Orders) pass it through so we
  // do not create a second getOrder poller for the same id.
  const orderQuery = useOrder(orderId, { enabled: !providedOrder })
  const order = providedOrder ?? orderQuery.data
  const terminal = isOrderTerminal(order)
  const watch = `${config.reactive.reactiveContract}:${config.base.paymentEscrow}:${config.unichain.assetEscrow}`
  const queryKey = ['proof', orderId, watch] as const
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
      return resolveProof(orderId!, config, clients, order, previous)
    },
  })
}

export interface HopStep {
  n: string
  key: string
  title: string
  chain: 'base' | 'unichain' | 'lasna'
  event?: ProofEvent
  note?: string
}

export function buildHops(order: Order | null | undefined, proof?: ProofData | null): HopStep[] {
  const refundMode = !!order?.refundRequested || !!proof?.paymentRefunded || !!proof?.assetRefunded
  const closing: Array<[string, string, 'base' | 'unichain', ProofEvent | undefined]> = refundMode
    ? [
        ['paymentRefund', 'Payment refunded', 'base', proof?.paymentRefunded],
        ['assetRefund', 'Asset refunded', 'unichain', proof?.assetRefunded],
      ]
    : [
        ['paymentRelease', 'Payment released', 'base', proof?.paymentReleased],
        ['assetRelease', 'Asset released', 'unichain', proof?.assetReleased],
      ]

  return [
    { n: '01', key: 'paymentLocked', title: 'Payment locked', chain: 'base', event: proof?.paymentLocked },
    { n: '02', key: 'assetLocked', title: 'Asset locked', chain: 'unichain', event: proof?.assetLocked },
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
  return `| ${step.n} ${step.title} | ${step.chain === 'lasna' ? 'Reactive Lasna' : step.chain === 'base' ? 'Base Sepolia' : 'Unichain Sepolia'} | ${hashCell} | ${block} | ${explorerCell} |`
}

export function buildProofMarkdown(
  orderId: Hex,
  order: Order | null | undefined,
  proof: ProofData | null | undefined,
): string {
  const hops = buildHops(order, proof)
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
    `- Payment: ${order?.paymentAmount?.toString() ?? '—'} (Base Sepolia)`,
    `- Asset: ${order?.assetAmount?.toString() ?? '—'} (Unichain Sepolia)`,
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
