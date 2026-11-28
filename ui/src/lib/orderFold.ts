import type {
  ApiOrderDetail,
  ApiOrderLeg,
  ApiOrderRow,
  SseCallback,
  SseEventName,
  SseLock,
  SseMeta,
  SseNotification,
  SseOrderState,
  SseRefunded,
  SseSettled,
  SseTerminal,
} from './api'
import { refundReasonKey } from './status'

const ZERO = '0x0000000000000000000000000000000000000000'

/** On-chain state stages that carry a refund cause, mapped to the API reason. */
const STAGE_REASON: Record<string, string> = {
  EXPIRED: 'expired',
  INVALID: 'invalid',
  CANCELLED: 'cancelled',
  LATE_REFUND: 'late',
  RACE_LOSER_REFUND: 'race_loser',
}

function text(value: unknown, fallback?: string): string | undefined {
  return typeof value === 'string' && value ? value : fallback
}

/** Mirrors the backend's deriveStatus for the fields the UI cares about. */
export function deriveApiStatus(row: ApiOrderRow): string {
  if (row.status === 'settled' || row.status === 'refunded' || row.status === 'cancelled') return row.status
  // API parity: the closure flags are authoritative. The indexer can hold only
  // one leg row for a fully closed order, so requiring two leg rows contradicts
  // the client pill (and SSE counts) for that order. This mirrors the backend's
  // `allLegsClosed()` exactly.
  const allClosed = !!(row.paymentClosed && row.assetClosed)
  // API parity: foldEvent persists a reason (race_loser / invalid / late /
  // expired) without setting `refund_requested`, and the backend's deriveStatus
  // treats that reason as the refund decision. Combine the decision flags with
  // the closure flags instead of reading the reason alone or the flag alone.
  const refundDecision = !!row.refundRequested || !!refundReasonKey(row.refundReason)
  if (allClosed && row.settleRequested) return 'settled'
  if (allClosed && refundDecision) return 'refunded'
  if (row.settleRequested) return 'settling'
  if (refundDecision) return 'refunding'
  if (row.paymentSeen && row.assetSeen) return 'bothLocked'
  if (row.paymentSeen || row.assetSeen) return 'awaitingLock'
  return 'open'
}

function appendTimeline(detail: ApiOrderDetail, meta: SseMeta, stage: string, payload: Record<string, unknown>, chainId = 5318007) {
  const entry = {
    at: meta.at,
    chainId,
    txHash: text(payload.txHash, ZERO) ?? ZERO,
    blockNumber: typeof payload.blockNumber === 'number' ? payload.blockNumber : 0,
    logIndex: 0,
    stage,
    payload,
  }
  return [...detail.timeline.filter((item) => !(item.stage === stage && item.txHash === entry.txHash && item.at === entry.at)), entry].slice(-200)
}

function upsertLeg(detail: ApiOrderDetail, leg: ApiOrderLeg): ApiOrderLeg[] {
  const index = detail.legs.findIndex((item) => item.role === leg.role && item.seller.toLowerCase() === leg.seller.toLowerCase())
  if (index === -1) return [...detail.legs, leg]
  const legs = [...detail.legs]
  legs[index] = { ...legs[index]!, ...leg }
  return legs
}

function baseLeg(detail: ApiOrderDetail, role: 'payment' | 'asset', seller: string): ApiOrderLeg {
  return {
    id: 0,
    orderId: detail.orderId,
    role,
    seller,
    token: role === 'payment' ? detail.paymentToken ?? ZERO : detail.assetToken ?? ZERO,
    amount: role === 'payment' ? detail.paymentAmount ?? '0' : detail.assetAmount ?? '0',
    counterparty: role === 'payment' ? detail.seller ?? ZERO : detail.buyer ?? ZERO,
    chainId: role === 'payment' ? detail.paymentChainId ?? 0 : detail.assetChainId ?? 0,
    txHash: ZERO,
    state: 'locked',
    nonce: 0,
    createdAt: detail.createdAt,
  }
}

/** Applies one named SSE payload to a cached `['order', id]` detail. */
export function patchApiOrder(
  detail: ApiOrderDetail | undefined,
  name: SseEventName,
  data: SseMeta & Record<string, unknown>,
): ApiOrderDetail | undefined {
  if (!detail) return undefined
  const payload = { ...data }
  let next: ApiOrderDetail = { ...detail }
  switch (name) {
    case 'order.state': {
      const stage = data as unknown as SseOrderState
      if (typeof stage.nonce === 'number' && stage.nonce < detail.nonce) return detail
      if (typeof stage.nonce === 'number') next.nonce = stage.nonce
      // The API attaches the persisted reason to state frames; it is
      // authoritative. Only infer a reason from the stage when no explicit
      // reason was forwarded (previously the inference overwrote it).
      const explicitReason = text(data.refundReason)
      const stageReason = STAGE_REASON[stage.stage]
      if (explicitReason) next.refundReason = explicitReason
      else if (stageReason) next.refundReason = stageReason
      if (stage.stage === 'EXPIRED') next.expired = true
      switch (stage.stage) {
        case 'CREATED': next.status = 'open'; break
        case 'CANCELLED': next.status = 'cancelled'; next.refundRequested = true; next.refundReason = 'cancelled'; break
        case 'PAYMENT_SEEN': next.paymentSeen = true; break
        case 'ASSET_SEEN': next.assetSeen = true; break
        case 'WINNER': break
        case 'SETTLE_REQUESTED':
          if (next.status !== 'refunded' && next.status !== 'cancelled') next.settleRequested = true
          break
        case 'REFUND_REQUESTED': if (!next.settleRequested) next.refundRequested = true; break
        case 'EXPIRED':
        case 'INVALID':
        case 'LATE_REFUND':
        case 'RACE_LOSER_REFUND':
          if (!next.settleRequested) next.refundRequested = true
          break
        case 'PAYMENT_CLOSED': next.paymentClosed = true; break
        case 'ASSET_CLOSED': next.assetClosed = true; break
        default: break
      }
      next.status = deriveApiStatus(next)
      break
    }
    case 'lock.payment': {
      const lock = data as unknown as SseLock
      next.paymentSeen = true
      next.buyer = lock.depositor ?? next.buyer
      if (lock.counterparty && lock.counterparty.toLowerCase() !== ZERO) next.seller = lock.counterparty
      next.paymentToken = lock.token
      next.paymentAmount = lock.amount
      next.deadline = lock.deadline ?? next.deadline
      next.termsHash = lock.termsHash ?? next.termsHash
      next.paymentChainId = lock.chainId
      next.legs = upsertLeg(next, { ...baseLeg(next, 'payment', ZERO), token: lock.token, amount: lock.amount, chainId: lock.chainId, txHash: lock.txHash, counterparty: lock.counterparty ?? next.seller ?? ZERO })
      next.status = deriveApiStatus(next)
      break
    }
    case 'lock.asset': {
      const lock = data as unknown as SseLock
      const seller = lock.seller ?? ZERO
      next.assetSeen = true
      next.assetToken = lock.token
      next.assetAmount = lock.amount
      next.deadline = lock.deadline ?? next.deadline
      next.termsHash = lock.termsHash ?? next.termsHash
      next.assetChainId = lock.chainId
      if (!next.legs.some((leg) => leg.role === 'asset' && leg.seller.toLowerCase() === seller.toLowerCase())) {
        next.assetLockCount += 1
      }
      next.legs = upsertLeg(next, { ...baseLeg(next, 'asset', seller), token: lock.token, amount: lock.amount, chainId: lock.chainId, txHash: lock.txHash, counterparty: lock.counterparty ?? next.buyer ?? ZERO })
      next.status = deriveApiStatus(next)
      break
    }
    case 'callback.requested': {
      const callback = data as unknown as SseCallback
      if (next.status !== 'refunded' && next.status !== 'cancelled') next.settleRequested = true
      next.status = deriveApiStatus(next)
      payload.chainId = callback.chainId
      break
    }
    case 'terminal.release':
    case 'terminal.refund': {
      const terminal = data as unknown as SseTerminal
      const seller = text(data.seller, ZERO) ?? ZERO
      const index = next.legs.findIndex((leg) =>
        leg.role === terminal.leg && (terminal.leg === 'payment' || leg.seller.toLowerCase() === seller.toLowerCase()),
      )
      if (name === 'terminal.release') {
        if (index >= 0) next.legs[index] = { ...next.legs[index]!, state: 'released', nonce: terminal.nonce }
        if (terminal.leg === 'payment') next.paymentClosed = true
        else {
          next.assetClosed = true
          if (seller !== ZERO) next.winner = seller
        }
      } else {
        if (index >= 0) next.legs[index] = { ...next.legs[index]!, state: 'refunded', nonce: terminal.nonce }
        if (terminal.leg === 'payment') next.paymentClosed = true
        else next.assetClosed = true
        next.refundRequested = true
      }
      next.status = deriveApiStatus(next)
      if (next.status === 'settled') next.settleRequested = true
      payload.chainId = terminal.chainId
      break
    }
    case 'order.settled': {
      const settled = data as unknown as SseSettled
      next.status = 'settled'
      next.settleRequested = true
      next.paymentClosed = true
      next.assetClosed = true
      next.legs = next.legs.map((leg) => ({ ...leg, state: 'released' }))
      void settled
      break
    }
    case 'order.refunded': {
      const refunded = data as unknown as SseRefunded
      next.status = 'refunded'
      next.refundRequested = true
      next.refundReason = refunded.reason || next.refundReason || null
      if (refundReasonKey(refunded.reason) === 'expired') next.expired = true
      next.legs = next.legs.map((leg) => ({ ...leg, state: 'refunded' }))
      break
    }
    default:
      return detail
  }
  next.updatedAt = data.at
  next.timeline = appendTimeline(next, data, name, payload, typeof payload.chainId === 'number' ? payload.chainId : 5318007)
  return next
}

export function notificationFromSse(data: SseNotification) {
  return {
    id: data.id,
    orderId: data.orderId,
    kind: data.kind,
    title: data.title,
    body: data.body,
    at: data.at,
    read: false,
  }
}
