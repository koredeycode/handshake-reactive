import type { Hex } from 'viem'
import type { Order } from './types'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex

export function normalizeAddress(value?: string | null): Hex | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null
  return trimmed.toLowerCase() as Hex
}

/** Accepts with/without 0x, trims whitespace, normalises to lowercase bytes32. */
export function normalizeOrderId(value?: string | null): Hex | null {
  if (!value) return null
  const trimmed = value.trim().replace(/^0x/i, '')
  if (!/^[a-fA-F0-9]{64}$/.test(trimmed)) return null
  return `0x${trimmed.toLowerCase()}` as Hex
}

export function randomOrderId(): Hex {
  const bytes = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
}

export function truncate(value?: string | null, lead = 6, tail = 4): string {
  if (!value) return '—'
  if (value.length <= lead + tail + 3) return value
  return `${value.slice(0, lead)}…${value.slice(-tail)}`
}

export function isZeroAddress(value?: string | null): boolean {
  return !value || value.toLowerCase() === ZERO_ADDRESS
}

/** Show a neutral placeholder only for API-null fields, never for a real zero. */
export function dashIfMissing(missing: boolean | undefined, value: string): string {
  return missing ? '—' : value
}

export function isEmptyOrder(order?: Order | null): boolean {
  if (!order) return true
  return isZeroAddress(order.buyer) && isZeroAddress(order.seller)
}

/** Canonical terms hashing lives in lib/terms.ts (venue-aware) — never duplicate it here. */

export function formatAmount(value: bigint | undefined | null, decimals = 18, symbol?: string): string {
  if (value === undefined || value === null) return '—'
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = abs % base
  let out = whole.toLocaleString('en-US')
  if (frac !== 0n) {
    const digits = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    out += `.${digits}`
  }
  return `${negative ? '-' : ''}${out}${symbol ? ` ${symbol}` : ''}`
}

/** Plain decimal string suitable for an input and parseUnits (no thousand separators). */
export function toUnitString(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const frac = value % base
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

export function formatNative(value: bigint | undefined | null, symbol: string): string {
  if (value === undefined || value === null) return '—'
  const eth = Number(value) / 1e18
  if (eth === 0) return `0 ${symbol}`
  if (eth < 0.0001) return `${eth.toFixed(8)} ${symbol}`
  return `${eth.toFixed(4)} ${symbol}`
}

export function formatDeadline(seconds?: bigint | null): string {
  if (seconds === undefined || seconds === null || seconds === 0n) return '—'
  const date = new Date(Number(seconds) * 1000)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' UTC'
}

export function formatTimestamp(seconds?: bigint | number | null): string {
  if (seconds === undefined || seconds === null) return '—'
  const value = typeof seconds === 'bigint' ? Number(seconds) : seconds
  if (!value) return '—'
  return formatDeadline(BigInt(Math.floor(value)))
}

/** Countdown against a unix-seconds deadline. `now` is unix seconds (float ok). */
export function countdown(deadline: bigint | undefined | null, now: number): string {
  if (deadline === undefined || deadline === null || deadline === 0n) return '—'
  const remaining = Number(deadline) - now
  if (remaining <= 0) return 'expired'
  if (remaining < 60) return `${Math.ceil(remaining)}s`
  if (remaining < 3600) {
    const m = Math.floor(remaining / 60)
    return `${m}m ${Math.ceil(remaining % 60)}s`
  }
  const h = Math.floor(remaining / 3600)
  const m = Math.floor((remaining % 3600) / 60)
  return `${h}h ${m}m`
}

/** Human-readable age of a timestamp in ms (e.g. the last SSE frame). */
export function formatAge(at?: number | null, now = Date.now()): string {
  if (!at) return '—'
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function deltaMs(from?: number | null, to?: number | null): string {
  if (!from || !to) return '—'
  const delta = to - from
  if (!Number.isFinite(delta)) return '—'
  if (Math.abs(delta) < 1000) return `${Math.round(delta)} ms`
  return `${(delta / 1000).toFixed(2)} s`
}

export function legStateName(state?: bigint | number | null): string {
  if (state === undefined || state === null) return '—'
  const n = Number(state)
  return ['NONE', 'LOCKED', 'RELEASED', 'REFUNDED'][n] ?? `UNKNOWN(${n})`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export function explorerLabel(chain: string): string {
  if (chain === 'lasna') return 'Reactscan'
  if (chain === 'base') return 'BaseScan'
  if (chain === 'sepolia') return 'Etherscan'
  return 'Uniscan'
}
