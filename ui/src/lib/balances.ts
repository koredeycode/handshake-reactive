import { useBalance, useReadContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS, CHAIN_LABELS } from './chains'
import { configuredAddress, useConfig } from './config'
import { erc20Abi } from './contracts'
import { formatAmount, formatNative } from './format'
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
  const config = useConfig()
  const payment = useTokenDisplay('payment')
  const asset = useTokenDisplay('asset')
  const owner = address as Address | undefined
  const enabled = !!address
  const balanceQuery = { enabled, refetchInterval: 15_000, staleTime: 10_000 }
  const paymentToken = configuredAddress(config.base.paymentToken)
  const assetToken = configuredAddress(config.unichain.assetToken)

  const baseNative = useBalance({ address: owner, chainId: CHAIN_IDS.base, query: balanceQuery })
  const unichainNative = useBalance({ address: owner, chainId: CHAIN_IDS.unichain, query: balanceQuery })
  const lasnaNative = useBalance({ address: owner, chainId: CHAIN_IDS.lasna, query: balanceQuery })

  const paymentBalance = useReadContract({
    address: (paymentToken ?? undefined) as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: CHAIN_IDS.base,
    query: { ...balanceQuery, enabled: enabled && !!paymentToken },
  })
  const assetBalance = useReadContract({
    address: (assetToken ?? undefined) as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: CHAIN_IDS.unichain,
    query: { ...balanceQuery, enabled: enabled && !!assetToken },
  })

  const nativeLabel = (query: typeof baseNative): string => {
    if (query.isError) return '—'
    if (query.isLoading || !query.data) return '…'
    return formatNative(query.data.value, query.data.symbol)
  }

  const erc20Label = (query: typeof paymentBalance, symbol: string, decimals: number): string => {
    if (query.isError) return '—'
    if (query.isLoading || query.data === undefined) return '…'
    return formatAmount(query.data, decimals, symbol)
  }

  return [
    {
      key: 'base-native',
      chain: 'base',
      asset: 'Native',
      label: nativeLabel(baseNative),
      title: `${CHAIN_LABELS.base} · native balance`,
    },
    {
      key: 'unichain-native',
      chain: 'unichain',
      asset: 'Native',
      label: nativeLabel(unichainNative),
      title: `${CHAIN_LABELS.unichain} · native balance`,
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
      chain: 'base',
      asset: payment.symbol,
      label: erc20Label(paymentBalance, payment.symbol, payment.decimals),
      title: `${payment.name} (${payment.symbol}) · ${CHAIN_LABELS.base}`,
    },
    {
      key: 'asset-token',
      chain: 'unichain',
      asset: asset.symbol,
      label: erc20Label(assetBalance, asset.symbol, asset.decimals),
      title: `${asset.name} (${asset.symbol}) · ${CHAIN_LABELS.unichain}`,
    },
  ]
}
