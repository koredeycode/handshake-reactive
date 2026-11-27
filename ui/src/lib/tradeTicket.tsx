import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { useReadContracts } from 'wagmi'
import { isAddress, type Hex } from 'viem'
import { fetchTokens, useApiBaseUrl, validateToken } from './api'
import { CHAIN_IDS, CHAIN_LABELS, chainKeyFromId, type TradingChainKey } from './chains'
import {
  curatedSelection,
  customSelection,
  useChainTokens,
  type ChainTokenOption,
  type TokenSelection,
} from './tokenDisplay'

export type TicketKind = 'payment' | 'asset'

interface TradeTicketState {
  paymentChain: TradingChainKey
  assetChain: TradingChainKey
  paymentToken: TokenSelection | null
  assetToken: TokenSelection | null
  payAmount: string
  receiveAmount: string
  /** Custom ERC-20s the user explicitly reviewed; shared with wallet discovery. */
  customTokens: Partial<Record<TradingChainKey, TokenSelection[]>>
}

interface TradeTicketContextValue extends TradeTicketState {
  setChain: (kind: TicketKind, chain: TradingChainKey) => void
  selectToken: (kind: TicketKind, token: TokenSelection) => void
  confirmCustom: (kind: TicketKind, token: TokenSelection) => void
  setPayAmount: (value: string) => void
  setReceiveAmount: (value: string) => void
  setAmounts: (pay: string, receive: string) => void
  flip: () => void
  isConfirmedCustom: (chain: TradingChainKey, address: string) => boolean
  optionsFor: (kind: TicketKind) => ChainTokenOption[]
  tokenFor: (kind: TicketKind) => TokenSelection | null
  chainFor: (kind: TicketKind) => TradingChainKey
}

const TradeTicketContext = createContext<TradeTicketContextValue | null>(null)

function initialState(): TradeTicketState {
  return {
    paymentChain: 'base',
    assetChain: 'unichain',
    paymentToken: null,
    assetToken: null,
    payAmount: '100',
    receiveAmount: '1',
    customTokens: {},
  }
}

export function TradeTicketProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TradeTicketState>(initialState)
  const listPayment = useChainTokens(state.paymentChain)
  const listAsset = useChainTokens(state.assetChain)
  const base = useApiBaseUrl()

  /** Custom tokens already validated on the API are treated as confirmed. */
  const catalog = useQuery({
    queryKey: ['tokens'],
    queryFn: () => fetchTokens({}, base),
    staleTime: 60_000,
    retry: 1,
  })
  const persistedCustom = useMemo(() => {
    const out: Partial<Record<TradingChainKey, TokenSelection[]>> = {}
    for (const row of catalog.data?.tokens ?? []) {
      if (row.source !== 'custom' || !row.symbol || row.decimals === null) continue
      const chain = chainKeyFromId(row.chainId)
      if (!chain || chain === 'lasna') continue
      out[chain] = [
        ...(out[chain] ?? []),
        customSelection(row.address as Hex, { name: row.symbol, symbol: row.symbol, decimals: row.decimals }),
      ]
    }
    return out
  }, [catalog.data])

  const customTokens = useMemo(() => {
    const out: Partial<Record<TradingChainKey, TokenSelection[]>> = { ...persistedCustom }
    for (const [chain, tokens] of Object.entries(state.customTokens) as Array<[TradingChainKey, TokenSelection[]]>) {
      const existing = out[chain] ?? []
      out[chain] = [
        ...existing,
        ...tokens.filter((token) => !existing.some((item) => item.address.toLowerCase() === token.address.toLowerCase())),
      ]
    }
    return out
  }, [persistedCustom, state.customTokens])

  const setChain = useCallback((kind: TicketKind, chain: TradingChainKey) => {
    setState((previous) => {
      if (previous[kind === 'payment' ? 'paymentChain' : 'assetChain'] === chain) return previous
      return kind === 'payment'
        ? { ...previous, paymentChain: chain, paymentToken: null }
        : { ...previous, assetChain: chain, assetToken: null }
    })
  }, [])

  const selectToken = useCallback((kind: TicketKind, token: TokenSelection) => {
    setState((previous) => ({
      ...previous,
      [kind === 'payment' ? 'paymentToken' : 'assetToken']: token,
    }))
  }, [])

  /** An explicit confirmation: register the token globally AND select it. */
  const confirmCustom = useCallback((kind: TicketKind, token: TokenSelection) => {
    setState((previous) => {
      const chain = kind === 'payment' ? previous.paymentChain : previous.assetChain
      const existing = previous.customTokens[chain] ?? []
      const customTokens = existing.some((entry) => entry.address.toLowerCase() === token.address.toLowerCase())
        ? previous.customTokens
        : { ...previous.customTokens, [chain]: [...existing, token] }
      return {
        ...previous,
        customTokens,
        [kind === 'payment' ? 'paymentToken' : 'assetToken']: token,
      }
    })
  }, [])

  const isConfirmedCustom = useCallback(
    (chain: TradingChainKey, address: string) =>
      (customTokens[chain] ?? []).some((entry) => entry.address.toLowerCase() === address.toLowerCase()),
    [customTokens],
  )

  const flip = useCallback(() => {
    setState((previous) => ({
      ...previous,
      paymentChain: previous.assetChain,
      assetChain: previous.paymentChain,
      paymentToken: previous.assetToken,
      assetToken: previous.paymentToken,
      payAmount: previous.receiveAmount,
      receiveAmount: previous.payAmount,
    }))
  }, [])

  const optionsFor = useCallback(
    (kind: TicketKind): ChainTokenOption[] => {
      const listed = kind === 'payment' ? listPayment : listAsset
      const chain = kind === 'payment' ? state.paymentChain : state.assetChain
      const custom = (customTokens[chain] ?? [])
        .filter((token) => !listed.some((entry) => entry.address.toLowerCase() === token.address.toLowerCase()))
        .map((token) => ({
          address: token.address as string,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          mark: token.mark,
          color: token.color,
          verified: false,
        }))
      return [...listed, ...custom]
    },
    [listPayment, listAsset, state.paymentChain, state.assetChain, customTokens],
  )

  const tokenFor = useCallback(
    (kind: TicketKind): TokenSelection | null => {
      const explicit = kind === 'payment' ? state.paymentToken : state.assetToken
      if (explicit) return explicit
      const first = optionsFor(kind).find((entry) => entry.verified) ?? optionsFor(kind)[0]
      return first ? curatedSelection(first) : null
    },
    [state.paymentToken, state.assetToken, optionsFor],
  )

  const value = useMemo<TradeTicketContextValue>(
    () => ({
      ...state,
      customTokens,
      setChain,
      selectToken,
      confirmCustom,
      setPayAmount: (payAmount) => setState((previous) => ({ ...previous, payAmount })),
      setReceiveAmount: (receiveAmount) => setState((previous) => ({ ...previous, receiveAmount })),
      setAmounts: (payAmount, receiveAmount) => setState((previous) => ({ ...previous, payAmount, receiveAmount })),
      flip,
      isConfirmedCustom,
      optionsFor,
      tokenFor,
      chainFor: (kind) => (kind === 'payment' ? state.paymentChain : state.assetChain),
    }),
    [state, customTokens, setChain, selectToken, confirmCustom, flip, isConfirmedCustom, optionsFor, tokenFor],
  )

  return <TradeTicketContext.Provider value={value}>{children}</TradeTicketContext.Provider>
}

export function useTradeTicket(): TradeTicketContextValue {
  const value = useContext(TradeTicketContext)
  if (!value) throw new Error('useTradeTicket must be used inside TradeTicketProvider')
  return value
}

interface ReadResult {
  result?: unknown
  status?: string
}

export interface CustomTokenLookup {
  status: 'idle' | 'loading' | 'ready' | 'error'
  token: TokenSelection | null
  balance: bigint | null
  error: string | null
}

/**
 * Custom-token metadata comes from the persisted API catalog/validate route.
 * A confirmed token is stored server-side and therefore survives a reload;
 * the picker still labels it unverified and requires the explicit checkbox.
 * Only the one-shot balanceOf preview stays on-chain (never polled).
 */
export function useCustomTokenLookup(chain: TradingChainKey, address: string, owner?: Hex | null): CustomTokenLookup {
  const valid = !!address && isAddress(address)
  const chainId = CHAIN_IDS[chain]
  const base = useApiBaseUrl()
  const normalized = valid ? address.toLowerCase() : ''

  const catalog = useQuery({
    queryKey: ['tokens', { chainId }],
    queryFn: () => fetchTokens({ chainId }, base),
    enabled: valid,
    staleTime: 60_000,
    retry: 1,
  })
  const existing = catalog.data?.tokens.find((token) => token.address.toLowerCase() === normalized)

  const validation = useQuery({
    queryKey: ['token-validate', chainId, normalized],
    queryFn: () => validateToken(chainId, address, base),
    enabled: valid && !!catalog.data && !existing,
    staleTime: Infinity,
    retry: 1,
  })

  const contracts = useMemo(() => {
    if (!valid || !owner) return [] as Array<Record<string, unknown>>
    return [{ address: address as Hex, abi: erc20LookupAbi, functionName: 'balanceOf', args: [owner], chainId }]
  }, [valid, address, chainId, owner])
  const balanceQuery = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 30_000, gcTime: Infinity, retry: false },
  }) as unknown as { data?: readonly ReadResult[] }
  const balance = typeof balanceQuery.data?.[0]?.result === 'bigint' ? balanceQuery.data[0].result : null

  if (!valid) return { status: 'idle', token: null, balance: null, error: null }
  const row = existing ?? validation.data?.token
  if (catalog.isLoading || (!row && validation.isLoading)) {
    return { status: 'loading', token: null, balance: null, error: null }
  }
  if (!row || !row.symbol || row.decimals === null || row.decimals < 0 || row.decimals > 36) {
    return {
      status: 'error',
      token: null,
      balance: null,
      error: 'Not a standard ERC-20: symbol()/decimals() could not be read.',
    }
  }
  const token = customSelection(address as Hex, { name: row.symbol, symbol: row.symbol, decimals: row.decimals })
  return { status: 'ready', token, balance, error: null }
}

const erc20LookupAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const UNVERIFIED_LABEL = 'Unverified'

export function chainLabelForToken(chain: TradingChainKey): string {
  return CHAIN_LABELS[chain]
}
