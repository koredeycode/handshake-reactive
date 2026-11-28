import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import {
  TOAST_NOTIFICATION_KINDS,
  streamUrl,
  useApiBaseUrl,
  type NotificationKind,
  type SseEventName,
  type SseKeeperStatus,
  type SseNotification,
  type SseOrderCreated,
  type SseMeta,
} from './api'
import { notificationFromSse, patchApiOrder } from './orderFold'
import { notificationToast } from './toasts'
import { queryKeys, type QueryKey } from './queryKeys'
import type { ApiOrderDetail } from './api'

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting'

export interface RealtimeNotification {
  id: string
  orderId: string
  kind: NotificationKind
  title: string
  body: string
  at: string
  read: boolean
}

interface RealtimeState {
  status: RealtimeStatus
  lastEventId: number | null
  lastEventAt: number | null
  /** True while reconnecting or when no frame has arrived for ~60s. */
  isStale: boolean
  staleReason: 'reconnecting' | 'idle' | null
  /** Set briefly after a `resync` frame so the shell can show "Resynced". */
  resyncedAt: number | null
  /** Chain ids whose RC/escrow reported debt > 0 — orders are `delayed`, not failed. */
  delayedChains: number[]
  /** Latest keeper telemetry frame per chain (debt/reserves, read-only). */
  keeperStatuses: Record<number, SseKeeperStatus>
  notifications: RealtimeNotification[]
  unreadCount: number
  acknowledge: (id: string) => void
  clearNotifications: () => void
}

const EMPTY_STATE: RealtimeState = {
  status: 'connecting',
  lastEventId: null,
  lastEventAt: null,
  isStale: true,
  staleReason: 'reconnecting',
  resyncedAt: null,
  delayedChains: [],
  keeperStatuses: {},
  notifications: [],
  unreadCount: 0,
  acknowledge: () => undefined,
  clearNotifications: () => undefined,
}

const RealtimeContext = createContext<RealtimeState>(EMPTY_STATE)

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext)
}

const EVENT_NAMES: SseEventName[] = [
  'hello',
  'order.created',
  'order.state',
  'lock.payment',
  'lock.asset',
  'callback.requested',
  'terminal.release',
  'terminal.refund',
  'order.settled',
  'order.refunded',
  'wallet.balance',
  'notification',
  'keeper.status',
  'resync',
  'heartbeat',
]

const ORDER_EVENTS = new Set<SseEventName>([
  'order.created',
  'order.state',
  'lock.payment',
  'lock.asset',
  'callback.requested',
  'terminal.release',
  'terminal.refund',
  'order.settled',
  'order.refunded',
])

/**
 * The one EventSource for the whole app. Named listeners patch the relevant
 * `['order', id]` cache entry immediately and schedule one debounced REST
 * revalidation per query key. No page opens its own stream.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const baseUrl = useApiBaseUrl()
  const { address } = useAccount()
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const [lastEventId, setLastEventId] = useState<number | null>(null)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [resyncedAt, setResyncedAt] = useState<number | null>(null)
  const [delayedChains, setDelayedChains] = useState<number[]>([])
  const [keeperStatuses, setKeeperStatuses] = useState<Record<number, SseKeeperStatus>>({})
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([])
  const [reconnectKey, setReconnectKey] = useState(0)

  const seenIds = useRef(new Set<number>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const lastMessageAt = useRef(Date.now())

  const scheduleInvalidate = useCallback((keys: QueryKey[]) => {
    for (const key of keys) {
      const id = JSON.stringify(key)
      const previous = timers.current.get(id)
      if (previous) clearTimeout(previous)
      timers.current.set(id, setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: key })
        timers.current.delete(id)
      }, 250))
    }
  }, [queryClient])

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])

  // Drive the staleness check without adding a timer per consumer.
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  // "Resynced" is a transient confirmation, not a permanent status.
  useEffect(() => {
    if (!resyncedAt) return
    const timer = window.setTimeout(() => setResyncedAt(null), 3_000)
    return () => window.clearTimeout(timer)
  }, [resyncedAt])

  useEffect(() => {
    const source = new EventSource(streamUrl(address, baseUrl))
    lastMessageAt.current = Date.now()
    setStatus('connecting')

    const accept = (incoming: number | undefined): boolean => {
      const id = Number(incoming) || 0
      if (id <= 0) return true // hello/heartbeat frames without a numeric cursor
      if (seenIds.current.has(id)) return false
      seenIds.current.add(id)
      if (seenIds.current.size > 2_000) {
        for (const value of Array.from(seenIds.current).slice(0, 500)) seenIds.current.delete(value)
      }
      return true
    }

    const onEvent = (name: SseEventName, data: Record<string, unknown>, eventId: string) => {
      const cursor = Number(eventId) || Number(data.eventId) || 0
      // Control frames share the current outbox cursor; they must never be
      // swallowed by the data-event dedupe set (resync may reuse hello's id).
      const control = name === 'hello' || name === 'heartbeat' || name === 'resync'
      if (!control && !accept(cursor)) return
      lastMessageAt.current = Date.now()
      if (cursor > 0) setLastEventId(cursor)
      setLastEventAt(Date.now())

      if (name === 'hello') {
        setStatus('open')
        if (data.statusCounts && typeof data.statusCounts === 'object') {
          queryClient.setQueryData(queryKeys.statusCounts(), data.statusCounts)
        }
        return
      }
      if (name === 'heartbeat') {
        setStatus((current) => (current === 'connecting' ? 'open' : current))
        return
      }
      if (name === 'resync') {
        void queryClient.invalidateQueries()
        setResyncedAt(Date.now())
        return
      }
      if (name === 'keeper.status') {
        const keeper = data as unknown as SseKeeperStatus
        const debt = BigInt(keeper.debtWei ?? '0')
        setDelayedChains((current) => {
          const filtered = current.filter((chainId) => chainId !== keeper.chainId)
          return debt > 0n ? [...filtered, keeper.chainId] : filtered
        })
        setKeeperStatuses((current) => ({ ...current, [keeper.chainId]: keeper }))
        queryClient.setQueryData(['health', 'keeper', keeper.chainId], keeper)
        scheduleInvalidate([queryKeys.health()])
        return
      }
      if (name === 'wallet.balance') {
        const wallet = typeof data.wallet === 'string' ? data.wallet : address
        scheduleInvalidate(wallet ? [queryKeys.walletBalances(wallet), queryKeys.walletTokens(wallet)] : [])
        return
      }
      if (name === 'notification') {
        const notification = data as unknown as SseNotification
        if (!notification.id || !TOAST_NOTIFICATION_KINDS.has(notification.kind)) return
        const item = notificationFromSse(notification)
        setNotifications((current) => {
          if (current.some((entry) => entry.id === item.id)) return current
          return [item, ...current].slice(0, 50)
        })
        notificationToast({ id: item.id, title: item.title, body: item.body, orderId: item.orderId })
        scheduleInvalidate([queryKeys.notifications()])
        return
      }
      if (ORDER_EVENTS.has(name)) {
        const orderId = typeof data.orderId === 'string' ? data.orderId : null
        if (orderId) {
          queryClient.setQueryData<ApiOrderDetail>(queryKeys.order(orderId), (old) =>
            patchApiOrder(old, name, data as SseMeta & Record<string, unknown>),
          )
        }
        if (name === 'order.created') {
          const created = data as unknown as SseOrderCreated
          if (created.termsHash) {
            queryClient.setQueryData(['order-created', created.orderId], created)
          }
        }
        scheduleInvalidate([queryKeys.orders(), ...(orderId ? [queryKeys.order(orderId)] : [])])
      }
    }

    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (event) => {
        const message = event as MessageEvent<string>
        try {
          onEvent(name, JSON.parse(message.data) as Record<string, unknown>, message.lastEventId)
        } catch {
          // Malformed frames are ignored; the resync/replay path repairs state.
        }
      })
    }
    source.onopen = () => {
      lastMessageAt.current = Date.now()
      setStatus('open')
    }
    source.onerror = () => setStatus('reconnecting')

    // The server heartbeats every 15s. If nothing arrives for 45s, force a
    // fresh connection; EventSource replays from Last-Event-ID on its own when
    // it reconnects, and the API sends `resync` if the cursor expired.
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastMessageAt.current > 45_000) {
        source.close()
        setReconnectKey((key) => key + 1)
      }
    }, 10_000)

    return () => {
      window.clearInterval(watchdog)
      source.close()
    }
  }, [address, baseUrl, queryClient, reconnectKey, scheduleInvalidate])

  const acknowledge = useCallback((id: string) => {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)))
  }, [])

  const clearNotifications = useCallback(() => setNotifications([]), [])

  useEffect(() => {
    queryClient.setQueryData(queryKeys.notifications(), notifications)
  }, [notifications, queryClient])

  const reconnecting = status !== 'open'
  const idle = lastEventAt !== null && clock - lastEventAt > 60_000
  const isStale = reconnecting || idle
  const staleReason = reconnecting ? 'reconnecting' : idle ? 'idle' : null

  const value = useMemo<RealtimeState>(() => ({
    status,
    lastEventId,
    lastEventAt,
    isStale,
    staleReason,
    resyncedAt,
    delayedChains,
    keeperStatuses,
    notifications,
    unreadCount: notifications.filter((item) => !item.read).length,
    acknowledge,
    clearNotifications,
  }), [status, lastEventId, lastEventAt, isStale, staleReason, resyncedAt, delayedChains, keeperStatuses, notifications, acknowledge, clearNotifications])

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}
