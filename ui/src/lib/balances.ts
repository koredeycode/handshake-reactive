import { useBalance } from 'wagmi'
import type { Address, Hex } from 'viem'
import {
  CHAIN_IDS,
  CHAIN_LABELS,
  TRADING_CHAIN_KEYS,
  type ChainKey,
  type TradingChainKey,
} from './chains'
import { formatAmount, formatNative, truncate } from './format'
import { useDiscoveredBalances } from './queries'
import { useChainTokens, type ChainTokenOption, type TokenSelection } from './tokenDisplay'
import { useTradeTicket } from './tradeTicket'

export interface BalanceChip {
  key: string
  chain: ChainKey
  /** Short row name inside the wallet dropdown, e.g. "Native" or a token symbol. */
  asset: string
  label: string
  title: string
}

interface NativeChip {
  key: string
  chain: ChainKey
  label: string
  data?: { value: bigint; symbol: string }
  isLoading: boolean
  isError: boolean
}

/**
 * Native balances for every settlement chain plus Lasna. Reads are scoped by
 * chainId, so they work from any connected chain. Long staleTime, no polling.
 */
function useNativeChips(address?: Hex | null): NativeChip[] {
  const owner = address as Address | undefined
  const query = { enabled: !!address, staleTime: 60_000, refetchInterval: false as const }
  const lasna = useBalance({ address: owner, chainId: CHAIN_IDS.lasna, query })
  const base = useBalance({ address: owner, chainId: CHAIN_IDS.base, query })
  const unichain = useBalance({ address: owner, chainId: CHAIN_IDS.unichain, query })
  const sepolia = useBalance({ address: owner, chainId: CHAIN_IDS.sepolia, query })
  return [
    { key: 'lasna-native', chain: 'lasna', label: 'Native', data: lasna.data, isLoading: lasna.isLoading, isError: lasna.isError },
    { key: 'base-native', chain: 'base', label: 'Native', data: base.data, isLoading: base.isLoading, isError: base.isError },
    { key: 'unichain-native', chain: 'unichain', label: 'Native', data: unichain.data, isLoading: unichain.isLoading, isError: unichain.isError },
    { key: 'sepolia-native', chain: 'sepolia', label: 'Native', data: sepolia.data, isLoading: sepolia.isLoading, isError: sepolia.isError },
  ]
}

function nativeLabel(chip: NativeChip): string {
  if (chip.isError) return '—'
  if (chip.isLoading || !chip.data) return '…'
  return formatNative(chip.data.value, chip.data.symbol)
}

/**
 * Curated catalog balances plus every custom ERC-20 the user confirmed.
 * Multicall is used on chains that declare Multicall3 (all three EVM chains);
 * no sustained polling, long staleTime.
 */
export function useWalletBalances(address?: Hex | null): BalanceChip[] {
  const { customTokens } = useTradeTicket()
  const catalogs = {
    base: useChainTokens('base', true),
    unichain: useChainTokens('unichain', true),
    sepolia: useChainTokens('sepolia', true),
  }
  const balances = {
    base: useDiscoveredBalances('base', [
      ...catalogs.base.map((token) => token.address),
      ...(customTokens.base ?? []).map((token) => token.address),
    ], address),
    unichain: useDiscoveredBalances('unichain', [
      ...catalogs.unichain.map((token) => token.address),
      ...(customTokens.unichain ?? []).map((token) => token.address),
    ], address),
    sepolia: useDiscoveredBalances('sepolia', [
      ...catalogs.sepolia.map((token) => token.address),
      ...(customTokens.sepolia ?? []).map((token) => token.address),
    ], address),
  }
  const natives = useNativeChips(address)

  const chips: BalanceChip[] = natives.map((chip) => ({
    key: chip.key,
    chain: chip.chain,
    asset: 'Native',
    label: nativeLabel(chip),
    title: `${CHAIN_LABELS[chip.chain]} · native balance`,
  }))

  for (const chain of TRADING_CHAIN_KEYS) {
    const entries: Array<ChainTokenOption | TokenSelection> = [
      ...catalogs[chain],
      ...(customTokens[chain] ?? []),
    ]
    const seen = new Set<string>()
    for (const entry of entries) {
      const key = `${chain}:token:${entry.address.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const value = balances[chain][entry.address.toLowerCase()]
      chips.push({
        key,
        chain,
        asset: entry.symbol,
        label: value === undefined || value === null ? (address ? '…' : '—') : formatAmount(value, entry.decimals, entry.symbol),
        title: `${entry.name} (${entry.symbol}) · ${CHAIN_LABELS[chain]} · ${entry.verified ? 'curated' : 'unverified'} · ${entry.address}`,
      })
    }
  }

  return chips
}

/** Group keys for the wallet dropdown, one group per chain. */
export function useBalanceGroups(): Array<{ chain: ChainKey; keys: string[] }> {
  const { customTokens } = useTradeTicket()
  const catalogs = {
    base: useChainTokens('base', true),
    unichain: useChainTokens('unichain', true),
    sepolia: useChainTokens('sepolia', true),
  }
  return TRADING_CHAIN_KEYS.flatMap((chain: TradingChainKey) => [
    {
      chain: chain as ChainKey,
      keys: [
        `${chain}-native`,
        ...catalogs[chain].map((token) => `${chain}:token:${token.address.toLowerCase()}`),
        ...(customTokens[chain] ?? []).map((token) => `${chain}:token:${token.address.toLowerCase()}`),
      ],
    },
  ]).concat([{ chain: 'lasna' as ChainKey, keys: ['lasna-native'] }])
}

export function balanceChipLabel(chip: BalanceChip): string {
  return chip.asset === 'Native' ? chip.asset : truncate(chip.asset, 8, 4)
}
