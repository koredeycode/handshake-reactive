/**
 * Canonical TanStack Query keys shared by the REST hooks and the single SSE
 * RealtimeProvider. The `['order', id]` key is what SSE patches directly.
 */
export const queryKeys = {
  orders: (filters: Record<string, string | number | undefined> = {}) => ['orders', filters] as const,
  order: (orderId?: string | null) => ['order', orderId] as const,
  walletBalances: (address?: string | null) => ['wallet', address?.toLowerCase() ?? null, 'balances'] as const,
  walletTokens: (address?: string | null) => ['wallet', address?.toLowerCase() ?? null, 'tokens'] as const,
  tokens: (filters: Record<string, unknown> = {}) => ['tokens', filters] as const,
  health: () => ['health'] as const,
  notifications: () => ['notifications'] as const,
  statusCounts: () => ['statusCounts'] as const,
  appConfig: () => ['app-config'] as const,
}

export type QueryKey = readonly unknown[]
