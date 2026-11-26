import type { Hex } from 'viem'
import type { ChainKey } from './chains'

/** Mirrors the Order tuple from PRD §5 / §6.1. */
export interface Order {
  buyer: Hex
  seller: Hex
  paymentToken: Hex
  paymentAmount: bigint
  assetToken: Hex
  assetAmount: bigint
  deadline: bigint
  paymentSeen: boolean
  assetSeen: boolean
  settleRequested: boolean
  refundRequested: boolean
  paymentClosed: boolean
  assetClosed: boolean
  paymentRefundRequested: boolean
  assetRefundRequested: boolean
  invalid: boolean
  nonce: bigint
  lastActionTimestamp: bigint
  winner: Hex
  assetLockCount: bigint
  paymentRequestNonce: bigint
  assetRequestNonce: bigint
}

export interface Leg {
  depositor: Hex
  counterparty: Hex
  token: Hex
  amount: bigint
  termsHash: Hex
  deadline: bigint
  state: bigint
  nonce: bigint
}

export interface Venues {
  paymentChainId: bigint
  paymentEscrow: Hex
  assetChainId: bigint
  assetEscrow: Hex
}

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_ASSET'
  | 'READY'
  | 'SETTLING'
  | 'SETTLED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'INVALID'

export type ProofEventKind =
  | 'paymentLocked'
  | 'assetLocked'
  | 'reactive'
  | 'paymentReleased'
  | 'assetReleased'
  | 'paymentRefunded'
  | 'assetRefunded'
  | 'callbackRequest'
  | 'cron10'

export interface ProofEvent {
  id: string
  kind: ProofEventKind
  chain: ChainKey
  txHash: Hex
  blockNumber: bigint
  logIndex: number
  timestamp: number | null
  fields: Record<string, string>
  nonce?: bigint
}

export interface ProofData {
  orderId: Hex
  events: ProofEvent[]
  paymentLocked?: ProofEvent
  assetLocked?: ProofEvent
  reactive?: ProofEvent
  paymentReleased?: ProofEvent
  assetReleased?: ProofEvent
  paymentRefunded?: ProofEvent
  assetRefunded?: ProofEvent
  scan: {
    lasnaFrom: bigint
    baseFrom: bigint
    unichainFrom: bigint
    to: bigint
  }
}
