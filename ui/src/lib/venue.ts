import {
  CHAIN_IDS,
  CHAIN_SHORT_LABELS,
  tradingChainKeyFromId,
  type TradingChainKey,
} from './chains'
import type { Venue, VenueRegistration } from './types'
import type { TicketKind } from './tradeTicket'

export interface LegVenue {
  chainKey: TradingChainKey
  chainId: number
  escrow: string | null
  token: string
}

/** Everything needed to read or display one leg comes from the order itself. */
export function venueOfOrder(order: {
  paymentToken: string
  assetToken: string
  venue: Venue
}, kind: TicketKind): LegVenue {
  const isPayment = kind === 'payment'
  const chainId = Number(isPayment ? order.venue.paymentChainId : order.venue.assetChainId)
  return {
    chainKey: tradingChainKeyFromId(chainId) ?? 'base',
    chainId,
    escrow: isPayment ? order.venue.paymentEscrow : order.venue.assetEscrow,
    token: isPayment ? order.paymentToken : order.assetToken,
  }
}

export function pairId(payment: TradingChainKey, asset: TradingChainKey): string {
  return `${payment}-${asset}`
}

export function parsePairId(id?: string | null): { payment: TradingChainKey; asset: TradingChainKey } | null {
  if (!id) return null
  const [payment, asset] = id.split('-')
  if (!payment || !asset) return null
  const keys = ['base', 'unichain', 'sepolia']
  if (!keys.includes(payment) || !keys.includes(asset)) return null
  return { payment: payment as TradingChainKey, asset: asset as TradingChainKey }
}

export function pairLabel(payment: TradingChainKey, asset: TradingChainKey): string {
  return `${CHAIN_SHORT_LABELS[payment]} → ${CHAIN_SHORT_LABELS[asset]}`
}

/** Build the per-order Venue tuple passed to createOrder / computeTermsHash. */
export function venueTuple(
  payment: VenueRegistration | null | undefined,
  asset: VenueRegistration | null | undefined,
): Venue | null {
  if (!payment?.paymentEscrow || !asset?.assetEscrow) return null
  return {
    paymentChainId: BigInt(CHAIN_IDS[payment.chainKey ?? 'base']),
    paymentEscrow: payment.paymentEscrow as `0x${string}`,
    assetChainId: BigInt(CHAIN_IDS[asset.chainKey ?? 'unichain']),
    assetEscrow: asset.assetEscrow as `0x${string}`,
  }
}

/** True when both legs live on registered chains with distinct escrows. */
export function isCompleteVenue(venue?: Venue | null): boolean {
  return !!venue && venue.paymentChainId !== venue.assetChainId
}
