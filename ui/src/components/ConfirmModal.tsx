import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { Button, icon } from './ui'

export interface ConfirmDetail {
  label: string
  value: ReactNode
}

/** Explicit token provenance for confirmations that lock a custom ERC-20. */
export interface ConfirmTokenRisk {
  address?: string | null
  decimals?: number | null
  source?: string
  verified?: boolean
}

/**
 * Shared pre-flight dialog for irreversible wallet writes. Every detail is
 * explicit — tokens, amounts, chains, deadline, counterparty and the gas note —
 * so the wallet signature is never a surprise. Mobile-first and 360px-safe.
 */
export default function ConfirmModal({
  title,
  description,
  details,
  gasNote,
  tokenRisks,
  confirmLabel = 'Confirm',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  description?: string
  details: ConfirmDetail[]
  gasNote?: string
  tokenRisks?: ConfirmTokenRisk[]
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Callers that do not pass explicit provenance (e.g. an existing leg) still
  // get the immutability notice whenever a "Token" row is in the summary.
  const risks: ConfirmTokenRisk[] = tokenRisks ??
    details.filter((detail) => /token/i.test(detail.label)).map((detail) => ({
      address: typeof detail.value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(detail.value) ? detail.value : null,
      source: 'existing order leg / token metadata',
    }))

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    confirmRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
    }
  }, [onCancel])

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-900/40 p-3 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="flex max-h-[88vh] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl border border-line bg-paper-0 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
      >
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-[15px] font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close confirmation"
            onClick={onCancel}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-700"
          >
            <X {...icon} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <dl className="divide-y divide-line rounded-xl border border-line bg-paper-50">
            {details.map((detail) => (
              <div key={detail.label} className="flex min-w-0 flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <dt className="shrink-0 text-[11px] text-ink-400">{detail.label}</dt>
                <dd className="min-w-0 break-words text-[12px] font-medium text-ink-800">{detail.value}</dd>
              </div>
            ))}
          </dl>
          {gasNote && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn">
              <AlertTriangle {...icon} className="mt-0.5 shrink-0" />
              <span>{gasNote}</span>
            </p>
          )}
          {risks.length > 0 && (
            <div className="mt-3 rounded-xl border border-warn/25 bg-warn-soft/60 px-3 py-2.5">
              <p className="flex items-start gap-2 text-[11px] font-medium text-warn">
                <AlertTriangle {...icon} className="mt-0.5 shrink-0" />
                Token details are final
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-700">
                This token cannot be changed once locked. Its address, decimals and amounts are bound into the order's
                terms hash — verify the contract before signing.
              </p>
              {risks.map((risk, index) => (
                <div key={`${risk.address ?? 'token'}-${index}`} className="mt-2 border-t border-warn/20 pt-2 text-[10px] leading-relaxed text-ink-500">
                  {risk.address && <p className="tnum break-all font-mono text-ink-700">{risk.address}</p>}
                  <p>
                    Decimals: {risk.decimals ?? 'read from token metadata'} · Source:{' '}
                    {risk.source ?? 'order leg / token metadata'}
                    {risk.verified === false ? ' · Unverified' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row-reverse sm:px-5">
          <Button
            ref={confirmRef}
            variant="primary"
            size="md"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-11 w-full justify-center sm:w-auto sm:min-w-[140px]"
          >
            {busy ? 'Confirming…' : confirmLabel}
          </Button>
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 w-full justify-center sm:w-auto"
          >
            Back
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
