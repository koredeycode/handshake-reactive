import { useCallback } from 'react'
import { configuredAddress } from './config'
import { chainKeyFromId, useMarket, type LegKind, type Market } from './markets'
import { useChainTokens, type ChainTokenOption } from './tokenDisplay'

export interface AssetOption extends ChainTokenOption {
  /** A deployed market settles this token on this side with the other leg unchanged. */
  supported: boolean
}

function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

function opposite(kind: LegKind): LegKind {
  return kind === 'payment' ? 'asset' : 'payment'
}

/**
 * A token is selectable on one side only if the registry has a market with
 * that exact token/chain on this side AND the current token/chain on the other
 * side. Unknown pairs never produce a write: the UI disables them and keeps
 * the last deployed pair.
 */
function marketForSelection(
  markets: readonly Market[],
  kind: LegKind,
  chainId: number,
  address: string,
  otherChainId: number,
  otherAddress?: string | null,
): Market | undefined {
  return markets.find((entry) => {
    const leg = entry[kind]
    const otherLeg = entry[opposite(kind)]
    return (
      leg.chainId === chainId &&
      sameAddress(leg.token, address) &&
      otherLeg.chainId === otherChainId &&
      sameAddress(otherLeg.token, otherAddress)
    )
  })
}

/** Asset choices for the two ticket sides, resolved entirely from the registry. */
export function useTicketAssetPairs() {
  const { market, markets, setMarket } = useMarket()
  const paymentChain = chainKeyFromId(market.payment.chainId, market.payment.chainKey)
  const assetChain = chainKeyFromId(market.asset.chainId, market.asset.chainKey)
  const listedPaymentTokens = useChainTokens(paymentChain)
  const listedAssetTokens = useChainTokens(assetChain)

  const optionsFor = (kind: LegKind): AssetOption[] => {
    const leg = market[kind]
    const otherLeg = market[opposite(kind)]
    const current = configuredAddress(leg.token)
    const tokens = kind === 'payment' ? listedPaymentTokens : listedAssetTokens
    // Before tokens.json resolves, keep the registry leg selectable rather
    // than showing an empty picker. Once it loads, both chain-local tokens show.
    const choices: ChainTokenOption[] = current && !tokens.some((token) => sameAddress(token.address, current))
      ? [
          {
            address: current,
            name: leg.tokenSymbol,
            symbol: leg.tokenSymbol,
            decimals: leg.tokenDecimals,
            mark: '',
            color: '',
          },
          ...tokens,
        ]
      : tokens
    const otherToken = configuredAddress(otherLeg.token)
    return choices.map((token) => ({
      ...token,
      supported: !!marketForSelection(
        markets,
        kind,
        leg.chainId,
        token.address,
        otherLeg.chainId,
        otherToken,
      ),
    }))
  }

  const select = useCallback(
    (kind: LegKind, address: string): boolean => {
      const leg = market[kind]
      const otherLeg = market[opposite(kind)]
      const target = marketForSelection(
        markets,
        kind,
        leg.chainId,
        address,
        otherLeg.chainId,
        configuredAddress(otherLeg.token),
      )
      if (!target) return false
      if (target.id !== market.id) setMarket(target.id)
      return true
    },
    [market, markets, setMarket],
  )

  return {
    paymentChain,
    assetChain,
    paymentOptions: optionsFor('payment'),
    assetOptions: optionsFor('asset'),
    selectedPayment: configuredAddress(market.payment.token),
    selectedAsset: configuredAddress(market.asset.token),
    selectPayment: (address: string) => select('payment', address),
    selectAsset: (address: string) => select('asset', address),
  }
}
