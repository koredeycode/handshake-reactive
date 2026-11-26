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
  label: string
  title: string
}

/**
 * Reads are scoped by chainId, so they work from any connected chain: there is
 * no wrong-chain error state to resolve. Every read is a plain eth_call — the
 * wagmi config keeps batch.multicall off because Lasna has no Multicall3.
 * Loading shows a dot and a failed read shows a dash; no value is invented.
 */
export function useWalletBalances(address?: Hex | null): BalanceChip[] {
  const config = useConfig()
  const payment = useTokenDisplay('payment')
  const asset = useTokenDisplay('asset')
  const owner = address as Address | undefined
  const enabled = !!address
  const paymentToken = configuredAddress(config.base.paymentToken)
  const assetToken = configuredAddress(config.unichain.assetToken)

  const baseNative = useBalance({ address: owner, chainId: CHAIN_IDS.base, query: { enabled } })
  const unichainNative = useBalance({ address: owner, chainId: CHAIN_IDS.unichain, query: { enabled } })
  const lasnaNative = useBalance({ address: owner, chainId: CHAIN_IDS.lasna, query: { enabled } })

  const paymentBalance = useReadContract({
    address: (paymentToken ?? undefined) as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: CHAIN_IDS.base,
    query: { enabled: enabled && !!paymentToken },
  })
  const assetBalance = useReadContract({
    address: (assetToken ?? undefined) as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: CHAIN_IDS.unichain,
    query: { enabled: enabled && !!assetToken },
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
      label: nativeLabel(baseNative),
      title: `${CHAIN_LABELS.base} · native balance`,
    },
    {
      key: 'unichain-native',
      chain: 'unichain',
      label: nativeLabel(unichainNative),
      title: `${CHAIN_LABELS.unichain} · native balance`,
    },
    {
      key: 'lasna-native',
      chain: 'lasna',
      label: nativeLabel(lasnaNative),
      title: `${CHAIN_LABELS.lasna} · native balance`,
    },
    {
      key: 'payment-token',
      chain: 'base',
      label: erc20Label(paymentBalance, payment.symbol, payment.decimals),
      title: `${payment.name} (${payment.symbol}) · ${CHAIN_LABELS.base}`,
    },
    {
      key: 'asset-token',
      chain: 'unichain',
      label: erc20Label(assetBalance, asset.symbol, asset.decimals),
      title: `${asset.name} (${asset.symbol}) · ${CHAIN_LABELS.unichain}`,
    },
  ]
}
