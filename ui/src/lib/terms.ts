import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import type { Venue } from './types'

/**
 * Canonical terms preimage, mirroring HandshakeReactive.termsHash():
 *
 *   keccak256(abi.encode(
 *     buyer, seller, paymentToken, paymentAmount, assetToken, assetAmount,
 *     deadline, venue.paymentChainId, venue.paymentEscrow,
 *     venue.assetChainId, venue.assetEscrow
 *   ))
 *
 * The venue fields are included so a deposit cannot be replayed against a
 * different venue. This is the only implementation: the trade form and every
 * LegCard call it, so they cannot drift apart.
 */
export interface TermsPreimage {
  buyer: Hex
  seller: Hex
  paymentToken: Hex
  paymentAmount: bigint
  assetToken: Hex
  assetAmount: bigint
  deadline: bigint
  venue: Venue
}

export function computeTermsHash(order: TermsPreimage): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [
        order.buyer,
        order.seller,
        order.paymentToken,
        order.paymentAmount,
        order.assetToken,
        order.assetAmount,
        order.deadline,
        order.venue.paymentChainId,
        order.venue.paymentEscrow,
        order.venue.assetChainId,
        order.venue.assetEscrow,
      ],
    ),
  )
}
