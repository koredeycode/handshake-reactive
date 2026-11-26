import type { Order, OrderStatus } from './types'

/** Client-side derivation from RC flags plus the wall clock. */
export function deriveStatus(order: Order, nowSeconds: number): OrderStatus {
  if (order.invalid) return 'INVALID'
  const closed = order.paymentClosed && order.assetClosed
  if (closed) return order.refundRequested ? 'REFUNDED' : 'SETTLED'
  if (order.refundRequested) return 'REFUNDING'
  if (order.settleRequested) return 'SETTLING'
  if (order.paymentSeen && order.assetSeen) return 'READY'
  if (Number(order.deadline) > 0 && Number(order.deadline) <= nowSeconds) return 'REFUNDING'
  if (order.paymentSeen) return 'AWAITING_ASSET'
  if (order.assetSeen) return 'AWAITING_PAYMENT'
  return 'AWAITING_PAYMENT'
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  AWAITING_ASSET: 'Awaiting asset',
  READY: 'Ready to settle',
  SETTLING: 'Settling',
  SETTLED: 'Settled',
  REFUNDING: 'Refunding',
  REFUNDED: 'Refunded',
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
  INVALID: 'bg-bad',
}
