import { useBalance, useReadContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS, CHAIN_LABELS } from './chains'
import { configuredAddress } from './config'
import { erc20Abi } from './contracts'
import { formatAmount, formatNative } from './format'
import { useMarket, type LegKind } from './markets'
import { useTokenDisplay } from './tokenDisplay'
import type { ChainKey } from './chains'

export interface BalanceChip {
  key: string
  chain: ChainKey
  /** Short row name inside the wallet dropdown, e.g. "Native" or a token symbol. */
  asset: string
  label: string
  title: string
}

/**
 * Reads are scoped by chainId, so they work from any connected chain: there is
 * no wrong-chain error state to resolve. Multicall is enabled per chain on
 * Base/Unichain and off on Lasna; smart polling keeps these at 15s instead of
 * wagmi's faster defaults. Loading shows a dot and a failed read shows a dash;
 * no value is invented.
 */
export function useWalletBalances(address?: Hex | null): BalanceChip[] {
  const { market, chainKeyFor, legConfig } = useMarket()
  const payment = useTokenDisplay('payment')
  const asset = useTokenDisplay('asset')
  const owner = address as Address | undefined
  const enabled = !!address
  const balanceQuery = { enabled, refetchInterval: 15_000, staleTime: 10_000 }
  const chainFor = (kind: LegKind): ChainKey => chainKeyFor(kind)
  const paymentToken = configuredAddress(legConfig('payment').token)
  const assetToken = configuredAddress(legConfig('asset').token)

  const paymentNative = useBalance({
    address: owner,
    chainId: CHAIN_IDS[chainFor('payment')],
    scopeKey: `${market.id}:payment-native`,
    query: balanceQuery,
  })
  const assetNative = useBalance({
    address: owner,
    chainId: CHAIN_IDS[chainFor('asset')],
    scopeKey: `${market.id}:asset-native`,
    query: balanceQuery,
  })
  const lasnaNative = useBalance({
    address: owner,
    chainId: CHAIN_IDS.lasna,
    scopeKey: `${market.id}:lasna-native`,
    query: balanceQuery,
  })

  const paymentBalance = useReadContract({
    address: (paymentToken ?? undefined) as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: CHAIN_IDS[chainFor('payment')],
    scopeKey: `${market.id}:payment-token`,
    query: { ...balanceQuery, enabled: enabled && !!paymentToken },
  })
  const assetBalance = useReadContract({
    address: (assetToken ?? undefined) as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: CHAIN_IDS[chainFor('asset')],
    scopeKey: `${market.id}:asset-token`,
    query: { ...balanceQuery, enabled: enabled && !!assetToken },
  })

  const nativeLabel = (query: typeof paymentNative): string => {
    if (query.isError) return '—'
    if (query.isLoading || !query.data) return '…'
    return formatNative(query.data.value, query.data.symbol)
  }

  const erc20Label = (query: typeof paymentBalance, symbol: string, decimals: number): string => {
    if (query.isError) return '—'
    if (query.isLoading || query.data === undefined) return '…'
    return formatAmount(query.data, decimals, symbol)
  }

  const paymentChain = chainFor('payment')
  const assetChain = chainFor('asset')

  return [
    {
      key: 'payment-native',
      chain: paymentChain,
      asset: 'Native',
      label: nativeLabel(paymentNative),
      title: `${CHAIN_LABELS[paymentChain]} · native balance`,
    },
    {
      key: 'asset-native',
      chain: assetChain,
      asset: 'Native',
      label: nativeLabel(assetNative),
      title: `${CHAIN_LABELS[assetChain]} · native balance`,
    },
    {
      key: 'lasna-native',
      chain: 'lasna',
      asset: 'Native',
      label: nativeLabel(lasnaNative),
      title: `${CHAIN_LABELS.lasna} · native balance`,
    },
    {
      key: 'payment-token',
      chain: paymentChain,
      asset: payment.symbol,
      label: erc20Label(paymentBalance, payment.symbol, payment.decimals),
      title: `${payment.name} (${payment.symbol}) · ${CHAIN_LABELS[paymentChain]}`,
    },
    {
      key: 'asset-token',
      chain: assetChain,
      asset: asset.symbol,
      label: erc20Label(assetBalance, asset.symbol, asset.decimals),
      title: `${asset.name} (${asset.symbol}) · ${CHAIN_LABELS[assetChain]}`,
    },
  ]
}
