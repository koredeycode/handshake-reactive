import { createContext, useContext, type ReactNode } from 'react'

/** Local default; set VITE_API_URL to the Fly origin in Vercel for previews/prod. */
export const DEFAULT_API_URL = 'http://localhost:8080'

export function normalizeApiUrl(base?: string | null): string {
  return (base || DEFAULT_API_URL).trim().replace(/\/+$/, '')
}

export const API_BASE_URL = normalizeApiUrl(import.meta.env.VITE_API_URL)

export interface ApiOrderRow {
  orderId: string
  termsHash: string | null
  buyer: string | null
  seller: string | null
  paymentChainId: number | null
  assetChainId: number | null
  paymentToken: string | null
  paymentAmount: string | null
  assetToken: string | null
  assetAmount: string | null
  deadline: string | null
  status: string
  settleRequested: boolean
  refundRequested: boolean
  paymentSeen: boolean
  assetSeen: boolean
  paymentClosed: boolean
  assetClosed: boolean
  winner: string | null
  assetLockCount: number
  nonce: number
  paymentRequestNonce: number
  assetRequestNonce: number
  protocolViolation: string | null
  createdAt: string
  updatedAt: string
}

export interface ApiOrderLeg {
  id: number
  orderId: string
  role: 'payment' | 'asset'
  seller: string
  token: string
  amount: string
  counterparty: string | null
  chainId: number
  txHash: string
  state: 'locked' | 'released' | 'refunded'
  nonce: number
  createdAt: string
}

export interface ApiTimelineEvent {
  at: string
  chainId: number
  txHash: string
  blockNumber: number
  logIndex: number
  stage: string
  payload: Record<string, unknown>
}

export interface ApiOrderDetail extends ApiOrderRow {
  legs: ApiOrderLeg[]
  timeline: ApiTimelineEvent[]
}

export interface ApiOrdersResponse {
  items: ApiOrderRow[]
  nextCursor: string | null
  limit: number
}

export interface ApiOrderEventsResponse {
  orderId: string
  events: Array<{
    id: number
    chainId: number
    txHash: string
    logIndex: number
    blockNumber: number
    blockHash: string
    address: string
    eventName: string
    payload: Record<string, unknown>
    removed: boolean
    receivedAt: string
  }>
}

export interface ApiTokenRow {
  id: number
  chainId: number
  address: string
  symbol: string | null
  decimals: number | null
  verified: boolean
  source: 'curated' | 'custom' | string
  metadataHash: string | null
  firstSeen: string
}

export interface ApiTokensResponse {
  tokens: ApiTokenRow[]
}

export interface ApiValidatedTokenResponse {
  token: ApiTokenRow
  verified: boolean
}

export interface ApiTokenBalance {
  address: string
  symbol: string | null
  decimals: number | null
  balance: string
  verified: boolean
  chainId: number
}

export interface ApiChainBalances {
  native: string
  tokens: ApiTokenBalance[]
}

export interface ApiWalletBalancesResponse {
  address: string
  chains: Record<string, ApiChainBalances>
  fetchedAt: string
  blockNumbers: Record<string, number>
}

export interface ApiWalletTokensResponse {
  address: string
  tokens: ApiTokenBalance[]
}

export interface ApiHealthResponse {
  ok: boolean
  database: boolean
  indexer: Array<{
    chainId: number
    status: string
    lastBlock: number
    lastEventAt: string | null
    lagSeconds: number
    reconnectCount: number
  }>
  lastEventAgeMs: number | null
  keeperFreshnessMs: number | null
  subscriptionCount: number
  outboxDepth: number
  walletCacheHitRatio: number
  uptimeSeconds: number
  metrics: { sseClients: number }
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClient {
  baseUrl: string
  request: <T>(path: string, init?: RequestInit) => Promise<T>
}

const ApiContext = createContext<ApiClient>({
  baseUrl: API_BASE_URL,
  request: (path, init) => requestApi(path, init, API_BASE_URL),
})

/** Optional override for tests/embeds; production uses VITE_API_URL. */
export function ApiProvider({ children, baseUrl }: { children: ReactNode; baseUrl?: string }) {
  const resolved = normalizeApiUrl(baseUrl ?? API_BASE_URL)
  return (
    <ApiContext.Provider
      value={{
        baseUrl: resolved,
        request: (path, init) => requestApi(path, init, resolved),
      }}
    >
      {children}
    </ApiContext.Provider>
  )
}

export function useApi(): ApiClient {
  return useContext(ApiContext)
}

export function useApiBaseUrl(): string {
  return useApi().baseUrl
}

export function apiUrl(path: string, base?: string | null): string {
  return `${normalizeApiUrl(base)}${path.startsWith('/') ? path : `/${path}`}`
}

export async function requestApi<T>(path: string, init: RequestInit | undefined, base?: string | null): Promise<T> {
  const response = await fetch(apiUrl(path, base), {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { error?: string }
      detail = body.error ?? ''
    } catch {
      detail = response.statusText
    }
    throw new ApiError(response.status, detail || `API ${response.status}`)
  }
  return (await response.json()) as T
}

export function streamUrl(wallet?: string | null, base?: string | null): string {
  const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''
  return apiUrl(`/stream${query}`, base)
}

// --- Typed read helpers ---------------------------------------------------

export function fetchOrders(
  filters: { status?: string; chain?: number; cursor?: string; limit?: number } = {},
  base?: string | null,
): Promise<ApiOrdersResponse> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.chain) params.set('chain', String(filters.chain))
  if (filters.cursor) params.set('cursor', filters.cursor)
  if (filters.limit) params.set('limit', String(filters.limit))
  const suffix = params.size ? `?${params.toString()}` : ''
  return requestApi<ApiOrdersResponse>(`/orders${suffix}`, undefined, base)
}

export function fetchOrder(orderId: string, base?: string | null): Promise<ApiOrderDetail> {
  return requestApi<ApiOrderDetail>(`/orders/${encodeURIComponent(orderId)}`, undefined, base)
}

export function fetchOrderEvents(orderId: string, base?: string | null): Promise<ApiOrderEventsResponse> {
  return requestApi<ApiOrderEventsResponse>(`/orders/${encodeURIComponent(orderId)}/events`, undefined, base)
}

export function fetchTokens(
  filters: { chainId?: number; verified?: boolean } = {},
  base?: string | null,
): Promise<ApiTokensResponse> {
  const params = new URLSearchParams()
  if (filters.chainId) params.set('chainId', String(filters.chainId))
  if (filters.verified !== undefined) params.set('verified', String(filters.verified))
  const suffix = params.size ? `?${params.toString()}` : ''
  return requestApi<ApiTokensResponse>(`/tokens${suffix}`, undefined, base)
}

/** Server-side metadata lookup; the API persists the row as verified/custom. */
export function validateToken(chainId: number, address: string, base?: string | null): Promise<ApiValidatedTokenResponse> {
  return requestApi<ApiValidatedTokenResponse>(
    '/tokens/validate',
    { method: 'POST', body: JSON.stringify({ chainId, address }) },
    base,
  )
}

export function fetchWalletBalances(address: string, chainIds?: number[], base?: string | null): Promise<ApiWalletBalancesResponse> {
  const suffix = chainIds?.length ? `?chainIds=${chainIds.join(',')}` : ''
  return requestApi<ApiWalletBalancesResponse>(`/wallet/${address}/balances${suffix}`, undefined, base)
}

export function fetchWalletTokens(address: string, base?: string | null): Promise<ApiWalletTokensResponse> {
  return requestApi<ApiWalletTokensResponse>(`/wallet/${address}/tokens`, undefined, base)
}

export function fetchHealth(base?: string | null): Promise<ApiHealthResponse> {
  return requestApi<ApiHealthResponse>('/health', undefined, base)
}

// --- SSE payloads (mirror of api/src/lib/events.ts) -----------------------

export type SseEventName =
  | 'hello'
  | 'order.created'
  | 'order.state'
  | 'lock.payment'
  | 'lock.asset'
  | 'callback.requested'
  | 'terminal.release'
  | 'terminal.refund'
  | 'order.settled'
  | 'order.refunded'
  | 'wallet.balance'
  | 'notification'
  | 'keeper.status'
  | 'resync'
  | 'heartbeat'

export interface SseMeta {
  eventId: number
  at: string
}

export interface SseHello extends SseMeta {
  lastEventId: number
  serverTime: string
  statusCounts: Record<string, number>
}

export interface SseOrderCreated extends SseMeta {
  orderId: string
  buyer?: string
  seller?: string
  paymentChainId?: number
  assetChainId?: number
  paymentToken?: string
  paymentAmount?: string
  assetToken?: string
  assetAmount?: string
  deadline?: string
  termsHash?: string
  txHash?: string
}

export interface SseOrderState extends SseMeta {
  orderId: string
  stage: string
  nonce: number
  txHash?: string
  blockNumber?: number
}

export interface SseLock extends SseMeta {
  orderId: string
  depositor?: string
  seller?: string
  counterparty?: string
  token: string
  amount: string
  termsHash?: string
  deadline?: string
  chainId: number
  txHash: string
}

export interface SseCallback extends SseMeta {
  orderId: string
  chainId: number
  functionName: string
  txHash: string
}

export interface SseTerminal extends SseMeta {
  orderId: string
  leg: 'payment' | 'asset'
  amount: string
  nonce: number
  chainId: number
  txHash: string
  protocolViolation?: boolean
}

export interface SseSettled extends SseMeta {
  orderId: string
  settledAt: string
  releaseTxHashes: { payment?: string; asset?: string }
}

export interface SseRefunded extends SseMeta {
  orderId: string
  reason: 'expired' | 'invalid' | 'cancelled' | 'late' | 'race_loser'
  refundedAt: string
  refundTxHashes: string[]
}

export interface SseWalletBalance extends SseMeta {
  wallet: string
  chainId: number
  token: string
  newBalance: string
  reason: 'lock' | 'release' | 'refund' | 'transfer'
  txHash: string
}

export type NotificationKind =
  | 'counterparty_locked'
  | 'settled'
  | 'refunded'
  | 'deadline_soon'
  | 'retry_failed'

export interface SseNotification extends SseMeta {
  id: string
  wallet: string
  orderId: string
  kind: NotificationKind
  title: string
  body: string
}

export interface SseKeeperStatus extends SseMeta {
  chainId: number
  target: string
  debtWei: string
  reservesWei: string
  action: 'none' | 'topup' | 'retry' | 'alert'
  txHash?: string
}

export interface SseResync extends SseMeta {
  reason: 'cursor_expired' | 'buffer_overflow'
  fromId: number
  toId: number
}

/** The backend whitelist for in-app toasts. Raw order/lock events never toast. */
export const TOAST_NOTIFICATION_KINDS = new Set<NotificationKind>([
  'counterparty_locked',
  'settled',
  'refunded',
  'deadline_soon',
  'retry_failed',
])
