import { useRealtime } from './RealtimeProvider'
import { CHAIN_IDS } from './chains'
import { isZeroAddress } from './format'
import { useNow } from './useNow'
import type { Order, OrderStatus } from './types'

/** Open orders carry a zero seller: any connected wallet can take the asset leg. */
export function isOpenOrder(order?: Order | null): boolean {
  return !!order && isZeroAddress(order.seller)
}

/** Buyer cancellation is only possible while the open order is unmatched and live. */
export function canCancelOpenOrder(
  order: Order | null | undefined,
  nowSeconds: number,
  address?: string | null,
): boolean {
  if (!order || !isOpenOrder(order)) return false
  if (!address || order.buyer.toLowerCase() !== address.toLowerCase()) return false
  if (order.invalid || order.refundRequested || order.settleRequested) return false
  if (order.paymentClosed || order.assetClosed || order.assetSeen) return false
  if (!isZeroAddress(order.winner) || Number(order.assetLockCount) > 0) return false
  return Number(order.deadline) > nowSeconds
}

/** Client-side derivation from RC flags plus the wall clock. */
export function deriveStatus(order: Order, nowSeconds: number, delayed = false): OrderStatus {
  if (order.invalid) return 'INVALID'
  // A refund can be terminal with only one leg locked (e.g. the seller never
  // locks): require closure only of legs that were actually seen, not both.
  if (
    order.refundRequested &&
    (!order.paymentSeen || order.paymentClosed) &&
    (!order.assetSeen || order.assetClosed)
  ) {
    return 'REFUNDED'
  }
  const closed = order.paymentClosed && order.assetClosed
  if (closed) return 'SETTLED'
  // RC debt pauses delivery. This is non-terminal: never show "failed" for an
  // order that is merely waiting for the network to resume.
  if (delayed) return 'DELAYED'
  if (order.refundRequested) return 'REFUNDING'
  if (order.settleRequested) return 'SETTLING'
  if (order.paymentSeen && order.assetSeen) return 'READY'
  if (Number(order.deadline) > 0 && Number(order.deadline) <= nowSeconds) return 'REFUNDING'
  if (order.paymentSeen) return 'AWAITING_ASSET'
  if (order.assetSeen) return 'AWAITING_PAYMENT'
  return 'AWAITING_PAYMENT'
}

/**
 * Status with the SSE `keeper.status` signal applied. Any chain reporting debt
 * > 0 makes pending orders `DELAYED`; terminal states are never overwritten.
 */
export function useOrderStatus(order?: Order | null): OrderStatus | null {
  const now = useNow()
  const { delayedChains } = useRealtime()
  if (!order) return null
  const chainIds = [
    CHAIN_IDS.lasna,
    Number(order.venue.paymentChainId),
    Number(order.venue.assetChainId),
  ]
  return deriveStatus(order, now, chainIds.some((id) => delayedChains.includes(id)))
}

/**
 * A terminal order cannot change on-chain any more: both legs closed, a refund
 * completed, or the RC flagged the order invalid. Pollers use this to stop as
 * soon as there is nothing left to observe. `settleRequested` alone is NOT
 * terminal (the callbacks are still in flight); `refundRequested` alone is not
 * terminal either until the leg(s) that were locked have been refunded.
 */
export function isOrderTerminal(order?: Order | null): boolean {
  if (!order) return false
  if (order.invalid) return true
  if (order.paymentClosed && order.assetClosed) return true
  if (
    order.refundRequested &&
    (!order.paymentSeen || order.paymentClosed) &&
    (!order.assetSeen || order.assetClosed)
  ) {
    return true
  }
  // A settle request with both legs already closed is the same settled case as
  // above; with legs still open it is deliberately still polled.
  return Boolean(order.settleRequested && order.paymentClosed && order.assetClosed)
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  AWAITING_ASSET: 'Awaiting asset',
  READY: 'Ready to settle',
  SETTLING: 'Settling',
  SETTLED: 'Settled',
  REFUNDING: 'Refunding',
  REFUNDED: 'Refunded',
  DELAYED: 'Delayed · network',
  INVALID: 'Invalid',
}

/** Pending states are neutral; the accent marks live activity only. */
export const STATUS_STYLES: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'border-line bg-paper-100 text-ink-500',
  AWAITING_ASSET: 'border-line bg-paper-100 text-ink-500',
  READY: 'border-accent/25 bg-accent-soft text-accent-ink',
  SETTLING: 'border-accent/25 bg-accent-soft text-accent-ink',
  SETTLED: 'border-line bg-paper-100 text-ink-700',
  REFUNDING: 'border-warn/25 bg-warn-soft text-warn',
  REFUNDED: 'border-line bg-paper-100 text-ink-500',
  DELAYED: 'border-warn/25 bg-warn-soft text-warn',
  INVALID: 'border-bad/25 bg-bad-soft text-bad',
}

export const STATUS_DOT: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'bg-ink-400',
  AWAITING_ASSET: 'bg-ink-400',
  READY: 'bg-accent',
  SETTLING: 'bg-accent',
  SETTLED: 'bg-ink-900',
  REFUNDING: 'bg-warn',
  REFUNDED: 'bg-ink-400',
  DELAYED: 'bg-warn',
  INVALID: 'bg-bad',
}
