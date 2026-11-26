import { useQuery } from '@tanstack/react-query'
import { useMarket } from './markets'

export interface LatencyRun {
  orderId?: string
  scenario: string
  /** Wall-clock epoch milliseconds captured by ts/observe.ts; null when unavailable. */
  t0SecondLockMs: number | null
  t1ReactiveMs: number | null
  t2PaymentCallbackMs: number | null
  t3AssetCallbackMs: number | null
  totalMs: number | null
  blockDeltas?: {
    lockToReactive?: number
    reactiveToPayment?: number
    reactiveToAsset?: number
  }
}

export interface LatencyData {
  updatedAt: string | null
  observer: string
  legacyBaselineMs: number
  runs: LatencyRun[]
}

const EMPTY: LatencyData = {
  updatedAt: null,
  observer: 'ts/observe.ts WebSocket observer — no data loaded',
  legacyBaselineMs: 7000,
  runs: [],
}

async function loadLatency(): Promise<LatencyData> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}latency.json`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as Partial<LatencyData>
    return {
      updatedAt: json.updatedAt ?? null,
      observer: json.observer ?? EMPTY.observer,
      legacyBaselineMs: Number(json.legacyBaselineMs ?? 7000),
      runs: Array.isArray(json.runs) ? json.runs : [],
    }
  } catch {
    return EMPTY
  }
}

export function useLatency() {
  const { market } = useMarket()
  return useQuery({
    queryKey: ['latency', market.id],
    queryFn: loadLatency,
    staleTime: 30_000,
  })
}

export function runForOrder(data: LatencyData | undefined, orderId?: string | null): LatencyRun | undefined {
  if (!orderId || !data) return undefined
  return data.runs.find((run) => run.orderId?.toLowerCase() === orderId.toLowerCase())
}
