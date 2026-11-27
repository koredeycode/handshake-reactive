import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { CHAIN_LABELS, EXPLORER_NAMES, txUrl, type ChainKey } from './chains'

const recentTx = new Map<string, number>()
const DEDUPE_MS = 15_000

function explorerLink(chain: ChainKey, hash: Hex): ReactNode {
  const url = txUrl(chain, hash)
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="toast-explorer-link">
      View on {EXPLORER_NAMES[chain]} ↗
    </a>
  )
}

type Hex = `0x${string}`

/**
 * Transaction lifecycle toast. The id is the tx hash, so sonner replaces the
 * pending toast in place and the map suppresses duplicate submissions.
 */
export function txToast(
  label: string,
  hash: string,
  chain: ChainKey,
  status: 'pending' | 'confirmed' | 'error',
): void {
  const validHash = /^0x[0-9a-fA-F]{64}$/.test(hash)
  const now = Date.now()
  const key = validHash ? `tx:${hash.toLowerCase()}` : `tx:${label}:error`
  if (validHash) {
    const previous = recentTx.get(key)
    if (previous && now - previous < DEDUPE_MS && status === 'pending') return
    recentTx.set(key, now)
  }
  const id = validHash ? key : `${key}:${now}`
  const description = (
    <span className="toast-description">
      {CHAIN_LABELS[chain]}
      {validHash && explorerLink(chain, hash as Hex)}
    </span>
  )
  if (status === 'pending') {
    toast.loading(`${label} submitted`, { id, description, duration: Infinity })
    return
  }
  if (status === 'confirmed') {
    toast.success(`${label} confirmed`, { id, description, duration: 6_000 })
    return
  }
  toast.error(`${label} failed`, { id, description: 'The transaction did not complete. Try again.', duration: 8_000 })
}

/** Dedupe by notification id; the backend already applies its own whitelist. */
const seenNotifications = new Set<string>()

export function notificationToast(args: { id: string; title: string; body: string; orderId: string }): void {
  if (seenNotifications.has(args.id)) return
  seenNotifications.add(args.id)
  toast(args.title, {
    id: `note:${args.id}`,
    description: args.body,
    duration: 8_000,
  })
}
