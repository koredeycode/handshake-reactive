import type { Hex } from 'viem'
import type { ChainKey, TradingChainKey } from './chains'

/**
 * Mirrors the trailing `Venue` tuple in HandshakeReactive.getOrder(). A venue is
 * stored per order, so a venue re-registration by the owner cannot move an
 * in-flight order.
 */
export interface Venue {
  paymentChainId: bigint
  paymentEscrow: Hex
  assetChainId: bigint
  assetEscrow: Hex
}

/** Fields that were null in the API row (as opposed to a real zero value). */
export type MissingOrderField =
  | 'buyer'
  | 'seller'
  | 'paymentToken'
  | 'assetToken'
  | 'paymentAmount'
  | 'assetAmount'
  | 'winner';

/** Mirrors the Order tuple from src/HandshakeReactive.sol (Option B). */
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
  venue: Venue
  /** Null API fields keep their zero-like view-model placeholder, but are
   *  flagged here so displays can show "—" instead of a misleading zero. */
  missing?: Partial<Record<MissingOrderField, true>>
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

/** `venue(chainId)` from the reactive registry. */
export interface VenueRegistration {
  chainId: number
  chainKey: TradingChainKey | null
  paymentEscrow: Hex | null
  assetEscrow: Hex | null
  registered: boolean
}

/** `escrows(address)` reverse lookup (role 1 = payment, 2 = asset). */
export interface EscrowMeta {
  chainId: bigint
  role: bigint
  registered: boolean
}

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_ASSET'
  | 'READY'
  | 'SETTLING'
  | 'SETTLED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'DELAYED'
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
    /** Role-keyed windows: payment/asset chains come from the order's venue. */
    paymentFrom: bigint
    assetFrom: bigint
    /** Per-chain scan tips, reused as a small cursor window on the next poll. */
    lasnaTo?: bigint
    paymentTo?: bigint
    assetTo?: bigint
    to: bigint
  }
}
