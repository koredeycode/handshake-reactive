import { useRealtime } from './RealtimeProvider'
import { CHAIN_IDS } from './chains'
import { isZeroAddress } from './format'
import { useNow } from './useNow'
import type { Leg, Order, OrderStatus, ProofData, RefundReason } from './types'

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

/**
 * A refund decision exists only when the RC actually emitted one. The wall
 * clock passing the deadline is NOT a decision — it is a wait for the deadline
 * sweep (live cron) or for permissionless expiry (prepared, not deployed).
 */
export function hasDecision(order?: Order | null): boolean {
  return !!order && (order.refundRequested || order.settleRequested)
}

/** A leg that was seen on-chain but has not closed yet can still be acted on. */
export function hasUnclosedSeenLeg(order?: Order | null): boolean {
  if (!order) return false
  return (order.paymentSeen && !order.paymentClosed) || (order.assetSeen && !order.assetClosed)
}

/**
 * Retry only re-requests a decision the RC already made. It cannot create a
 * refund from a no-decision order, so never offer it as a recovery affordance
 * where it is a no-op (it would only cost the user Lasna gas).
 */
export function canRetrySettlement(order?: Order | null): boolean {
  return hasDecision(order) && hasUnclosedSeenLeg(order)
}

/** The RC's RETRY_COOLDOWN, in seconds, between refund-request actions. */
export const EXPIRE_COOLDOWN_SECONDS = 30

/**
 * Eligibility for the prepared (post-Cron100-redeploy) permissionless `expire`.
 * A non-null order is the UI's "has an id / known order" equivalent of the RC's
 * `UnknownOrder` guard. The remaining guards mirror the contract's silent
 * no-ops: deadline reached, no settlement decision, no refund decision, and
 * not both legs closed. Invalid orders are terminal/cancelled in the UI and
 * never need recovery. The cooldown is reported separately by
 * `expireCooldownRemaining` so the countdown can be rendered live.
 *
 * This is future-only: no action is available until the new RC is live.
 */
export function canExpireOrder(order: Order | null | undefined, nowSeconds: number): boolean {
  if (!order) return false
  if (order.invalid) return false
  const deadline = Number(order.deadline)
  if (!deadline || deadline > nowSeconds) return false
  if (order.settleRequested || order.refundRequested) return false
  if (order.paymentClosed && order.assetClosed) return false
  return true
}

/**
 * Estimated seconds left on the RC's `lastActionTimestamp + RETRY_COOLDOWN`,
 * rounded up so a nonzero estimate never displays as zero. ADVISORY ONLY: the
 * view model derives `lastActionTimestamp` from the API row's `updatedAt`, not
 * from the contract clock. The RC's own 30-second cooldown is authoritative, so
 * this estimate must never disable the expire button — an early call simply
 * reverts on-chain.
 */
export function expireCooldownRemaining(order: Order | null | undefined, nowSeconds: number): number {
  if (!order) return 0
  const last = Number(order.lastActionTimestamp ?? 0n)
  if (!last) return 0
  return Math.max(0, Math.ceil(last + EXPIRE_COOLDOWN_SECONDS - nowSeconds))
}

/** A refund with every leg that was actually seen closed is terminal. */
function refundTerminal(order: Order): boolean {
  return (
    order.refundRequested &&
    (!order.paymentSeen || order.paymentClosed) &&
    (!order.assetSeen || order.assetClosed)
  )
}

/**
 * Advisory window for a refund decision with no terminal log. Roughly N
 * deadline-sweep ticks on the live cadence; this is a wall-clock proxy over the
 * public index's `updatedAt`, NOT a measurement of the contract clock. Crossing
 * it means "taking longer than usual", never "the refund is definitely stuck".
 */
export const REFUND_STALL_AFTER_SECONDS = 180

function refundStalled(order: Order, nowSeconds: number): boolean {
  const last = Number(order.lastActionTimestamp ?? 0n)
  if (!last) return false
  return nowSeconds - last > REFUND_STALL_AFTER_SECONDS
}

/** Client-side derivation from RC flags plus the wall clock and SSE signals. */
export function deriveStatus(order: Order, nowSeconds: number, delayed = false): OrderStatus {
  const reasonKey = refundReasonKey(order.refundReason)
  // A buyer cancellation is persisted with the RC's `invalid` flag on legacy
  // rows. It is a refund/cancellation, never a red "Invalid" pill.
  if (reasonKey === 'cancelled') return 'REFUNDED'
  if (order.invalid) return 'INVALID'

  const expired = !!order.expired || reasonKey === 'expired'
  if (refundTerminal(order)) return expired ? 'EXPIRED' : 'REFUNDED'

  // API parity: both origin legs closed is settled, even if the indexer only
  // persisted one leg row (see the `settling` vs `Settled` split in the audit).
  if (order.paymentClosed && order.assetClosed) return 'SETTLED'

  // Debt pauses callback delivery. It is non-terminal and has its own banner,
  // so it only replaces the pending/awaiting vocabulary, never a decision.
  if (delayed && !hasDecision(order)) return 'DELAYED'

  if (order.refundRequested) {
    return refundStalled(order, nowSeconds) ? 'REFUND_STALLED' : 'REFUND_PENDING'
  }
  if (order.settleRequested) return 'SETTLING'
  if (order.paymentSeen && order.assetSeen) return 'READY'

  const deadlinePassed = Number(order.deadline) > 0 && Number(order.deadline) <= nowSeconds
  if (deadlinePassed) {
    // No decision and nothing left to close: the deadline sweep has nothing to
    // act on. This is the stranded order case — it needs attention, not a
    // "Refunding" label that asserts a decision nobody made.
    return hasUnclosedSeenLeg(order) ? 'WAITING_FOR_EXPIRY' : 'STALLED'
  }
  if (order.paymentSeen) return 'AWAITING_ASSET'
  return 'AWAITING_PAYMENT'
}

/** True when any chain this order touches is in the realtime delayed set. */
export function isOrderDelayed(order: Order | null | undefined, delayedChains: readonly number[]): boolean {
  if (!order || !delayedChains.length) return false
  return [
    CHAIN_IDS.lasna,
    Number(order.venue.paymentChainId),
    Number(order.venue.assetChainId),
  ].some((id) => delayedChains.includes(id))
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
 * completed, or the RC flagged the order invalid. `settleRequested` alone is
 * NOT terminal (the callbacks are still in flight); `refundRequested` alone is
 * not terminal until the leg(s) that were locked have been refunded.
 */
export function isOrderTerminal(order?: Order | null): boolean {
  if (!order) return false
  if (order.invalid) return true
  if (order.paymentClosed && order.assetClosed) return true
  if (refundTerminal(order)) return true
  return Boolean(order.settleRequested && order.paymentClosed && order.assetClosed)
}

const REFUND_REASON_LABEL: Record<RefundReason, string> = {
  expired: 'Expired',
  invalid: 'Invalid',
  cancelled: 'Cancelled',
  late: 'Late lock',
  race_loser: 'Lost race',
}

/** Normalise an API/SSE refund reason, tolerating absent and future values. */
export function refundReasonKey(value?: string | null): RefundReason | null {
  if (!value) return null
  const key = value.toLowerCase().replace(/[-_\s]/g, '')
  if (key === 'expired' || key === 'expire') return 'expired'
  if (key === 'invalid') return 'invalid'
  if (key === 'cancelled' || key === 'canceled' || key === 'cancel') return 'cancelled'
  if (key === 'late' || key === 'latelock' || key === 'laterefund') return 'late'
  if (key === 'raceresult' || key === 'raceloser' || key === 'raceloserrefund') return 'race_loser'
  return null
}

/** Short label for the pill/tooltip and the settlement-trail header. */
export function refundReasonLabel(value?: string | null): string | null {
  const key = refundReasonKey(value)
  return key ? REFUND_REASON_LABEL[key] : null
}

/** Plain-language explanation for a refund cause, never used as a guess. */
export function refundReasonSentence(value?: string | null): string | null {
  const key = refundReasonKey(value)
  switch (key) {
    case 'expired':
      return 'The deadline passed before settlement completed.'
    case 'invalid':
      return 'The order failed validation on-chain.'
    case 'cancelled':
      return 'The buyer cancelled this order before it matched.'
    case 'late':
      return 'The lock arrived after the refund decision; it was returned automatically.'
    case 'race_loser':
      return 'Another seller locked first. Your asset was returned automatically.'
    default:
      return null
  }
}

/**
 * On-chain/index evidence that a refund actually happened. A persisted reason
 * string on its own is NOT evidence: historical rows carried `race_loser` on
 * healthy matched orders because of a bad WINNER mapping.
 */
export interface RefundEvidence {
  decision: boolean
  paymentHash: boolean
  assetHash: boolean
  paymentLegRefunded: boolean
  assetLegRefunded: boolean
}

const NO_REFUND_EVIDENCE: RefundEvidence = {
  decision: false,
  paymentHash: false,
  assetHash: false,
  paymentLegRefunded: false,
  assetLegRefunded: false,
}

/** Gather the refund evidence available to a given view. */
export function refundEvidence(
  order?: Order | null,
  proof?: Pick<ProofData, 'paymentRefunded' | 'assetRefunded'> | null,
  legs?: { payment?: Pick<Leg, 'state'> | null; asset?: Pick<Leg, 'state'> | null } | null,
): RefundEvidence {
  const cancelled = refundReasonKey(order?.refundReason) === 'cancelled'
  return {
    decision: !!order?.refundRequested || (cancelled && !!order?.invalid),
    paymentHash: !!proof?.paymentRefunded?.txHash,
    assetHash: !!proof?.assetRefunded?.txHash,
    paymentLegRefunded: legs?.payment?.state === 3n,
    assetLegRefunded: legs?.asset?.state === 3n,
  }
}

/**
 * Returns a normalised refund reason ONLY when a real refund is evidenced.
 * `race_loser` additionally requires an asset refund hash or a refunded asset
 * leg — a stale reason on a settled order must never claim a lost race.
 */
export function displayRefundReason(
  reason: string | null | undefined,
  evidence: RefundEvidence = NO_REFUND_EVIDENCE,
): string | null {
  const key = refundReasonKey(reason)
  if (!key) return null
  const refunded =
    evidence.decision ||
    evidence.paymentHash ||
    evidence.assetHash ||
    evidence.paymentLegRefunded ||
    evidence.assetLegRefunded
  if (!refunded) return null
  if (key === 'race_loser' && !(evidence.assetHash || evidence.assetLegRefunded)) return null
  return key
}

/**
 * Statuses the pill can present. `OPEN` and `CANCELLED` are presentation-only
 * variants for facts the UI already knows (an unmatched order, a cancelled
 * reason); `deriveStatus` still reports those as AWAITING_* / REFUNDED, so no
 * status semantics change. Every value gets its own distinct treatment below.
 */
export type PillStatus = OrderStatus | 'OPEN' | 'CANCELLED'

/** Combined tooltip copy for a status pill with an evidenced refund cause. */
export function statusTooltip(
  status: PillStatus,
  reason?: string | null,
  evidence?: RefundEvidence,
): string | undefined {
  const shown = displayRefundReason(reason, evidence)
  const cause = refundReasonLabel(shown)
  const detail = refundReasonSentence(shown)
  const base = STATUS_LABEL[status]
  if (!cause || !detail) return base
  return `${base} · ${cause} — ${detail}`
}

export const STATUS_LABEL: Record<PillStatus, string> = {
  OPEN: 'Open',
  AWAITING_PAYMENT: 'Awaiting payment',
  AWAITING_ASSET: 'Awaiting asset',
  READY: 'Ready to settle',
  SETTLING: 'Settling',
  SETTLED: 'Settled',
  REFUNDED: 'Refunded',
  INVALID: 'Invalid',
  CANCELLED: 'Cancelled',
  DELAYED: 'Delayed · network',
  STALLED: 'Needs attention',
  WAITING_FOR_EXPIRY: 'Waiting for expiry',
  REFUND_PENDING: 'Refund pending',
  REFUND_STALLED: 'Refund delayed',
  EXPIRED: 'Expired',
}

/**
 * One distinct treatment per status. The colour family carries the outcome
 * (accent = live activity, good = settled, warn = attention, bad = failure,
 * ink = terminal-neutral); border weight/style and dot shape then separate the
 * states that share a family. All text/soft-background pairs use existing
 * tokens with accessible contrast, and pills stay a single compact line.
 */
export const STATUS_STYLES: Record<PillStatus, string> = {
  OPEN: 'border-accent/40 bg-paper-0 text-accent-ink',
  AWAITING_PAYMENT: 'border-line bg-paper-50 text-ink-500',
  AWAITING_ASSET: 'border-line bg-paper-100 text-ink-700',
  READY: 'border-accent/25 bg-accent-soft text-accent-ink',
  SETTLING: 'border-accent/50 bg-accent-soft text-accent-ink',
  SETTLED: 'border-good/35 bg-good-soft text-good font-semibold',
  REFUNDED: 'border-ink-500/30 bg-paper-200 text-ink-700',
  INVALID: 'border-bad/50 bg-bad-soft text-bad font-semibold',
  // Cancelled is terminal-neutral with a dashed outline — never the red INVALID
  // treatment, even though legacy rows carry the RC's `invalid` flag.
  CANCELLED: 'border-dashed border-ink-400/50 bg-paper-50 text-ink-700',
  DELAYED: 'border-warn/25 bg-warn-soft text-warn',
  STALLED: 'border-bad/25 bg-bad-soft text-bad',
  WAITING_FOR_EXPIRY: 'border-warn/40 bg-warn-soft text-warn',
  REFUND_PENDING: 'border-warn/40 bg-warn/10 text-warn',
  REFUND_STALLED: 'border-dashed border-bad/40 bg-bad-soft text-bad',
  EXPIRED: 'border-warn/50 bg-warn-soft text-warn font-semibold',
}

/**
 * Full marker classes (size, shape, colour) so each status keeps a unique dot
 * without relying on conflicting utility order in the pill.
 */
export const STATUS_DOT: Record<PillStatus, string> = {
  OPEN: 'h-2 w-2 rounded-full bg-accent ring-1 ring-accent/30',
  AWAITING_PAYMENT: 'h-1.5 w-1.5 rounded-full bg-ink-400',
  AWAITING_ASSET: 'h-1.5 w-1.5 rounded-sm bg-ink-500',
  READY: 'h-1.5 w-1.5 rounded-full bg-accent',
  SETTLING: 'h-2 w-2 rounded-full bg-accent ring-2 ring-accent/20',
  SETTLED: 'h-1.5 w-1.5 rounded-full bg-good',
  REFUNDED: 'h-1.5 w-1.5 rounded-sm bg-ink-700',
  INVALID: 'h-1.5 w-1.5 rounded-sm bg-bad',
  CANCELLED: 'h-1.5 w-1.5 rounded-sm bg-ink-400 ring-1 ring-ink-400/40',
  DELAYED: 'h-1.5 w-1.5 rounded-full bg-warn',
  STALLED: 'h-1.5 w-1.5 rounded-full bg-bad',
  WAITING_FOR_EXPIRY: 'h-1.5 w-1.5 rounded-sm bg-warn',
  REFUND_PENDING: 'h-2 w-2 rounded-full bg-warn ring-2 ring-warn/20',
  REFUND_STALLED: 'h-2 w-2 rounded-full bg-bad ring-2 ring-bad/20',
  EXPIRED: 'h-1.5 w-1.5 rounded-sm bg-warn ring-1 ring-warn/40',
}
