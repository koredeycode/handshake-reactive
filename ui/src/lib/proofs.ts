import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { CHAIN_IDS, EXPLORER_NAMES, txUrl } from './chains'
import { useConfig } from './config'
import { formatTimestamp, truncate } from './format'
import { logClient, resolveProof, type ProofClients } from './logs'
import type { Order, ProofData, ProofEvent } from './types'

export function useProofClients(): ProofClients {
  const lasna = usePublicClient({ chainId: CHAIN_IDS.lasna })
  const base = usePublicClient({ chainId: CHAIN_IDS.base })
  const unichain = usePublicClient({ chainId: CHAIN_IDS.unichain })
  return { lasna: logClient(lasna), base: logClient(base), unichain: logClient(unichain) }
}

export function useProof(orderId?: Hex | null) {
  const config = useConfig()
  const clients = useProofClients()
  const watch = `${config.reactive.reactiveContract}:${config.base.paymentEscrow}:${config.unichain.assetEscrow}`
  return useQuery({
    queryKey: ['proof', orderId, watch],
    enabled: !!orderId,
    refetchInterval: 5_000,
    queryFn: async (): Promise<ProofData> => resolveProof(orderId!, config, clients),
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
  const release: Array<[string, string, 'base' | 'unichain', ProofEvent | undefined]> = [
    ['paymentRelease', '④ Payment released', 'base', proof?.paymentReleased],
    ['assetRelease', '⑤ Asset released', 'unichain', proof?.assetReleased],
  ]
  const refund: Array<[string, string, 'base' | 'unichain', ProofEvent | undefined]> = [
    ['paymentRefund', '④ Payment refunded', 'base', proof?.paymentRefunded],
    ['assetRefund', '⑤ Asset refunded', 'unichain', proof?.assetRefunded],
  ]

  return [
    { n: '①', key: 'paymentLocked', title: 'Payment locked', chain: 'base', event: proof?.paymentLocked },
    { n: '②', key: 'assetLocked', title: 'Asset locked', chain: 'unichain', event: proof?.assetLocked },
    {
      n: '③',
      key: 'reactive',
      title: 'Reactive decision',
      chain: 'lasna',
      event: proof?.reactive,
      note: 'CallbackRequest',
    },
    ...(refundMode ? refund : release).map(([key, title, chain, event]) => ({
      n: key.includes('payment') ? '④' : '⑤',
      key,
      title: title.replace(/^[④⑤]\s*/, ''),
      chain,
      event,
    })),
  ]
}

function markdownRow(step: HopStep): string {
  const hash = step.event?.txHash
  const url = txUrl(step.chain, hash)
  const hashCell = hash ? `\`${hash}\`` : '— (not observed yet)'
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
  if (!proof) return 'Not observed yet'
  const hashes = proof.events.map((e) => truncate(e.txHash, 8, 6))
  return hashes.length ? hashes.join(' · ') : 'Not observed yet'
}
