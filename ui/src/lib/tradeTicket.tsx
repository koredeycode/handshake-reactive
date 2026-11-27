import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useReadContracts } from 'wagmi'
import { isAddress, type Hex } from 'viem'
import { CHAIN_IDS, CHAIN_LABELS, type TradingChainKey } from './chains'
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
      (state.customTokens[chain] ?? []).some((entry) => entry.address.toLowerCase() === address.toLowerCase()),
    [state.customTokens],
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
      const custom = (state.customTokens[chain] ?? []).map((token) => ({
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
    [listPayment, listAsset, state.paymentChain, state.assetChain, state.customTokens],
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
    [state, setChain, selectToken, confirmCustom, flip, isConfirmedCustom, optionsFor, tokenFor],
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
 * Fetch symbol()/name()/decimals() (+ balanceOf) for a user-pasted ERC-20.
 * Metadata is untrusted: callers must label it unverified and require an
 * explicit checkbox before using it as a leg. This hook never selects.
 */
export function useCustomTokenLookup(chain: TradingChainKey, address: string, owner?: Hex | null): CustomTokenLookup {
  const valid = !!address && isAddress(address)
  const chainId = CHAIN_IDS[chain]
  const contracts = useMemo(() => {
    if (!valid) return [] as Array<Record<string, unknown>>
    const normalized = address as Hex
    const base: Array<Record<string, unknown>> = [
      { address: normalized, abi: erc20LookupAbi, functionName: 'symbol', chainId },
      { address: normalized, abi: erc20LookupAbi, functionName: 'decimals', chainId },
      { address: normalized, abi: erc20LookupAbi, functionName: 'name', chainId },
    ]
    if (owner) {
      base.push({ address: normalized, abi: erc20LookupAbi, functionName: 'balanceOf', args: [owner], chainId })
    }
    return base
  }, [valid, address, chainId, owner])

  const query = useReadContracts({
    contracts,
    query: { enabled: valid, staleTime: Infinity, gcTime: Infinity, retry: false },
  }) as unknown as {
    data?: readonly ReadResult[]
    isLoading: boolean
    isError: boolean
  }

  if (!valid) return { status: 'idle', token: null, balance: null, error: null }
  if (query.isLoading) return { status: 'loading', token: null, balance: null, error: null }
  const [symbolResult, decimalsResult, nameResult, balanceResult] = query.data ?? []
  const symbol = typeof symbolResult?.result === 'string' ? symbolResult.result : null
  const decimals = decimalsResult?.result
  if (symbol === null || typeof decimals !== 'number' || decimals < 0 || decimals > 36) {
    return {
      status: 'error',
      token: null,
      balance: null,
      error: 'Not a standard ERC-20: symbol()/decimals() could not be read.',
    }
  }
  const name = typeof nameResult?.result === 'string' && nameResult.result ? nameResult.result : symbol
  const token = customSelection(address as Hex, { name, symbol, decimals })
  const balance = typeof balanceResult?.result === 'bigint' ? balanceResult.result : null
  return { status: 'ready', token, balance, error: null }
}

const erc20LookupAbi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
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
