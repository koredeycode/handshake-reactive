import type { ReactNode } from 'react'
import { CHAIN_SHORT, txUrl } from '../lib/chains'
import { copyText, truncate } from '../lib/format'
import { STATUS_DOT, STATUS_STYLES } from '../lib/status'
import { useCopyFeedback } from '../lib/proofs'
import type { ChainKey } from '../lib/chains'
import type { OrderStatus } from '../lib/types'

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-white/[0.07] bg-ink-900/80 shadow-panel ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Metric({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad'
}) {
  const toneClass =
    tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-slate-100'
  return (
    <div className="rounded-xl border border-white/[0.05] bg-ink-850/60 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-sm font-medium ${toneClass}`}>{value ?? '—'}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

export function ChainBadge({ chain }: { chain: ChainKey }) {
  const color =
    chain === 'lasna'
      ? 'border-reactive/40 bg-reactive/10 text-reactive'
      : chain === 'base'
        ? 'border-payment/40 bg-payment/10 text-payment'
        : 'border-asset/40 bg-asset/10 text-asset'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${color}`}>
      {CHAIN_SHORT[chain]}
    </span>
  )
}

export function ExternalLink({
  href,
  children,
  className = '',
}: {
  href?: string | null
  children: ReactNode
  className?: string
}) {
  if (!href) return <span className={`text-slate-600 ${className}`}>{children}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex items-center gap-1 text-payment underline decoration-payment/30 underline-offset-2 transition hover:text-sky-300 hover:decoration-sky-300 ${className}`}
    >
      {children}
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 shrink-0 fill-current opacity-70">
        <path d="M6 2h8v8h-1.5V4.9L7.8 9.6 6.6 8.4l4.7-4.7H6V2Zm-3 3h3v1.5H4.5v6h6V10H12v3.5h-8V5Z" />
      </svg>
    </a>
  )
}

export function TxLink({ chain, hash, label }: { chain: ChainKey; hash?: string | null; label?: string }) {
  if (!hash) return <span className="text-slate-600">— not observed yet</span>
  return (
    <ExternalLink href={txUrl(chain, hash)} className="font-mono text-xs">
      {label ?? truncate(hash, 10, 8)}
    </ExternalLink>
  )
}

export function CopyButton({
  text,
  label = 'Copy',
  disabled,
  className = '',
}: {
  text: string
  label?: string
  disabled?: boolean
  className?: string
}) {
  const { copied, setCopied } = useCopyFeedback()
  const key = label
  return (
    <button
      type="button"
      disabled={disabled || !text}
      onClick={async () => {
        const ok = await copyText(text)
        setCopied(ok ? key : 'failed')
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
        <path d="M5 2h7a2 2 0 0 1 2 2v7h-1.5V4a.5.5 0 0 0-.5-.5H5V2Zm-2 3h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
      {copied === key ? 'Copied!' : copied === 'failed' ? 'Copy failed' : label}
    </button>
  )
}

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide ${STATUS_STYLES[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {status}
    </span>
  )
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-ink-850/40 px-6 py-12 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-500">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
          <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm0 9a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {message && <p className="mt-1 max-w-md text-xs text-slate-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-slate-200 ${className}`}
      role="status"
      aria-label="loading"
    />
  )
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-ink-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
      {children}
    </pre>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-300">
        {label}
        {hint && <span className="text-[11px] font-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-white/10 bg-ink-950/70 px-3 py-2 font-mono text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-reactive/60 focus:ring-1 focus:ring-reactive/30 disabled:opacity-50'
