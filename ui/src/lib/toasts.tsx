import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { CHAIN_LABELS, EXPLORER_NAMES, txUrl, type ChainKey } from './chains'

type Hex = `0x${string}`

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

export type TxErrorKind = 'rejected' | 'chain' | 'allowance' | 'balance' | 'rpc' | 'unknown'

export interface ClassifiedTxError {
  kind: TxErrorKind
  title: string
  message: string
}

/**
 * Wallets and RPCs disagree on error shape, so classify from every string they
 * expose (name, code, message, shortMessage). Order matters: a user rejection
 * of a chain switch is still a rejection, not a chain/RPC failure.
 */
export function classifyTxError(error: unknown, chain: ChainKey): ClassifiedTxError {
  const err = (error && typeof error === 'object' ? error : {}) as {
    name?: string
    code?: number | string
    message?: string
    shortMessage?: string
  }
  const raw = [err.name, err.code, err.message, err.shortMessage]
    .filter((part) => part !== undefined && part !== null)
    .join(' ')
    .toLowerCase()
  const on = CHAIN_LABELS[chain]

  if (/user rejected|user denied|action_rejected|4001|rejected the request|denied the request|cancelled the request|user rejected the request/.test(raw)) {
    return {
      kind: 'rejected',
      title: 'Transaction rejected',
      message: `You cancelled the request in your wallet. Nothing was sent on ${on}.`,
    }
  }
  if (/chain mismatch|wrong chain|wrong network|switch.*chain|chain.*not supported|unsupported chain|chain ?id|does not support chain|switchchainerror/.test(raw)) {
    return {
      kind: 'chain',
      title: 'Wrong network',
      message: `The wallet is on a different network. Switch to ${on} before signing.`,
    }
  }
  if (/insufficient allowance|exceeds allowance|allowance amount|spending cap|erc20: insufficient allowance|erc-20: insufficient allowance|needs? approval/.test(raw)) {
    return {
      kind: 'allowance',
      title: 'Token allowance too low',
      message: `The escrow cannot spend enough ${on} tokens. Approve the exact amount first, then retry the lock.`,
    }
  }
  if (/insufficient funds|insufficient balance|exceeds balance|insufficient native|insufficient eth|not enough (native|gas|balance)|gas required exceeds/.test(raw)) {
    return {
      kind: 'balance',
      title: 'Insufficient balance',
      message: `The connected wallet cannot cover the amount or gas on ${on}. Fund it and retry.`,
    }
  }
  if (/rate limit|too many requests|timeout|timed out|network error|fetch failed|http 429|429|-32005|-32603|service unavailable|bad gateway|json-rpc|rpc request|connection failed/.test(raw)) {
    return {
      kind: 'rpc',
      title: 'Network unavailable',
      message: `The ${on} RPC did not answer. No transaction was sent — try again in a moment.`,
    }
  }
  // Unknown errors keep the short reason so the user is never told only that
  // "the transaction did not complete".
  const reason = typeof err.shortMessage === 'string' && err.shortMessage
    ? err.shortMessage
    : typeof err.message === 'string' && err.message
      ? err.message
      : 'An unexpected error occurred.'
  return {
    kind: 'unknown',
    title: 'Transaction failed',
    message: `${reason.slice(0, 180)} (${on})`,
  }
}

/** Inline copy for the leg card's error panel. */
export function txErrorMessage(error: unknown, chain: ChainKey): string {
  const classified = classifyTxError(error, chain)
  return `${classified.title}: ${classified.message}`
}

/**
 * Transaction lifecycle toast. The id is the tx hash, so sonner replaces the
 * pending toast in place and the map suppresses duplicate submissions.
 */
export function txToast(
  label: string,
  hash: string,
  chain: ChainKey,
  status: 'pending' | 'confirmed' | 'error',
  error?: unknown,
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
  const classified = status === 'error' && error !== undefined ? classifyTxError(error, chain) : null
  const description = (
    <span className="toast-description">
      {label} · {CHAIN_LABELS[chain]}
      {classified && <span>{classified.message}</span>}
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
  toast.error(classified?.title ?? `${label} failed`, { id, description, duration: 8_000 })
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
