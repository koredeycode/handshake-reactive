import { useCallback } from 'react'
import { type TradingChainKey } from './chains'
import { curatedSelection, type ChainTokenOption } from './tokenDisplay'
import { useTradeTicket, type TicketKind } from './tradeTicket'
import { useVenues } from './venues'

export interface AssetOption extends ChainTokenOption {
  /** Kept for callers that used the old deployed-market flag. Always true now. */
  supported: boolean
}

/**
 * With token-agnostic escrows every token on a registered chain pair can be
 * a leg. Selection is disabled only when there is no token at all (the
 * custom-token picker enforces its own ERC-20 interface + confirmation).
 */
export function useTicketAssetPairs() {
  const ticket = useTradeTicket()
  const venues = useVenues()
  const paymentChain = ticket.chainFor('payment')
  const assetChain = ticket.chainFor('asset')

  const optionsFor = (kind: TicketKind): AssetOption[] =>
    ticket.optionsFor(kind).map((token) => ({ ...token, supported: true }))

  const select = useCallback(
    (kind: TicketKind, address: string) => {
      const option = ticket.optionsFor(kind).find((entry) => entry.address.toLowerCase() === address.toLowerCase())
      if (!option) return false
      ticket.confirmCustom(kind, curatedSelection(option))
      return true
    },
    [ticket],
  )

  return {
    paymentChain,
    assetChain,
    paymentOptions: optionsFor('payment'),
    assetOptions: optionsFor('asset'),
    selectedPayment: ticket.tokenFor('payment')?.address ?? null,
    selectedAsset: ticket.tokenFor('asset')?.address ?? null,
    selectPayment: (address: string) => select('payment', address),
    selectAsset: (address: string) => select('asset', address),
    paymentVenue: venues.byChain(paymentChain),
    assetVenue: venues.byChain(assetChain),
    setPaymentChain: (chain: TradingChainKey) => ticket.setChain('payment', chain),
    setAssetChain: (chain: TradingChainKey) => ticket.setChain('asset', chain),
  }
}
