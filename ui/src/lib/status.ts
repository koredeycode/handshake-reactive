import type { Order, OrderStatus } from './types'

/** Client-side derivation from RC flags plus the wall clock (PRD screen 4). */
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

export const STATUS_STYLES: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  AWAITING_ASSET: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
  READY: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  SETTLING: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  SETTLED: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-300',
  REFUNDING: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  REFUNDED: 'border-slate-400/40 bg-slate-400/10 text-slate-300',
  INVALID: 'border-red-400/50 bg-red-400/10 text-red-300',
}

export const STATUS_DOT: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'bg-slate-400',
  AWAITING_ASSET: 'bg-sky-400',
  READY: 'bg-emerald-400',
  SETTLING: 'bg-amber-400 animate-pulse-soft',
  SETTLED: 'bg-emerald-400',
  REFUNDING: 'bg-amber-400 animate-pulse-soft',
  REFUNDED: 'bg-slate-400',
  INVALID: 'bg-red-400',
}
