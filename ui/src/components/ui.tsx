import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Inbox } from 'lucide-react'
import { CHAIN_LABELS, CHAIN_LOGO, TRADING_CHAIN_KEYS, txUrl, type TradingChainKey } from '../lib/chains'
import { copyText, truncate } from '../lib/format'
import { useMarket } from '../lib/markets'
import { useCopyFeedback } from '../lib/proofs'
import { STATUS_DOT, STATUS_LABEL, STATUS_STYLES } from '../lib/status'
import type { ChainKey } from '../lib/chains'
import type { OrderStatus } from '../lib/types'

/** One icon set, one size, one stroke across the product. */
export const icon = { size: 16, strokeWidth: 1.5 } as const

/** The signature: two lines converge into one. Used in the logo and the decision node. */
export function ConvergenceMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6c5.5 0 6.5 6 9 6" />
      <path d="M3 18c5.5 0 6.5-6 9-6" />
      <path d="M12 12h9" />
    </svg>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet'
  size?: 'sm' | 'md'
  icon?: ReactNode
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: leadingIcon,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const shape =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
  const sizing = size === 'sm' ? 'h-10 px-3.5 text-[12px]' : 'h-11 px-5 text-[13px]'
  const tone =
    variant === 'primary'
      ? 'bg-accent text-white hover:bg-accent-ink'
      : variant === 'quiet'
        ? 'text-ink-500 hover:bg-paper-100 hover:text-ink-900'
        : 'border border-line bg-paper-0 text-ink-700 hover:bg-paper-100'
  return (
    <button type={type} className={`${shape} ${sizing} ${tone} ${className}`} {...rest}>
      {leadingIcon}
      {children}
    </button>
  )
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
  bodyClass = 'p-6',
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={`rounded-2xl border border-line bg-paper-0 ${className}`}>
      {(title || subtitle || action) && (
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            {title && <h2 className="text-sm font-medium text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
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
    tone === 'good'
      ? 'text-good'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'bad'
          ? 'text-bad'
          : 'text-ink-900'
  return (
    <div className="rounded-xl border border-line bg-paper-50 px-4 py-3">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className={`tnum mt-1 font-mono text-sm ${toneClass}`}>{value ?? '—'}</div>
      {hint && <div className="mt-1 text-[11px] text-ink-400">{hint}</div>}
    </div>
  )
}

/**
 * Official colored chain logos served from public/chains. Rendered at one
 * consistent 16px across pills, route strips, order rows and timelines.
 */
export function ChainMark({
  chain,
  className = 'h-4 w-4',
}: {
  chain: ChainKey
  className?: string
}) {
  return (
    <img
      src={CHAIN_LOGO[chain]}
      className={`${className} shrink-0`}
      alt={CHAIN_LABELS[chain]}
      title={CHAIN_LABELS[chain]}
      draggable={false}
    />
  )
}

/** The selected market's route: payment chain → Reactive Lasna → asset chain. */
export function RouteStrip({ className = '' }: { className?: string }) {
  const { chainKeyFor } = useMarket()
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400 ${className}`}>
      {/* Pills travel with their arrow so lines never end on an orphan arrow. */}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <ChainPill chain={chainKeyFor('payment')} />
        <ArrowRight {...icon} className="hidden sm:block" />
      </span>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <ChainPill chain="lasna" />
        <ArrowRight {...icon} className="hidden sm:block" />
      </span>
      <ChainPill chain={chainKeyFor('asset')} />
    </div>
  )
}

/** Chain name paired with its inline mark, for compact copy. */
export function ChainName({ chain, className = '' }: { chain: ChainKey; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${className}`}>
      <ChainMark chain={chain} />
      {CHAIN_LABELS[chain]}
    </span>
  )
}

/** Inline SVG circle mark with one or two letters. No external images, no gradients. */
export function TokenMark({
  symbol,
  kind = 'neutral',
  size = 'md',
  mark,
  color,
}: {
  symbol?: string | null
  kind?: 'payment' | 'asset' | 'neutral'
  size?: 'sm' | 'md' | 'lg'
  mark?: string | null
  color?: string | null
}) {
  const letters = (mark || tokenLetters(symbol)).slice(0, 2).toUpperCase()
  const fill =
    color ??
    (kind === 'payment'
      ? '#18181b'
      : kind === 'asset'
        ? '#5c5c66'
        : '#e6e6ea')
  const foreground = color ? '#ffffff' : kind === 'neutral' ? '#35353b' : '#ffffff'
  const dimensions = size === 'lg' ? 'h-10 w-10' : size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
  return (
    <svg
      viewBox="0 0 32 32"
      className={`${dimensions} shrink-0`}
      role="img"
      aria-label={`${symbol ?? 'token'} mark`}
    >
      <circle cx="16" cy="16" r="16" fill={fill} />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fill={foreground}
        fontFamily="SFMono-Regular, Menlo, monospace"
        fontSize="13"
        fontWeight="600"
      >
        {letters}
      </text>
    </svg>
  )
}

/** A mark is just the first two letters of the real symbol, never a made-up logo. */
function tokenLetters(symbol?: string | null): string {
  const clean = (symbol ?? '').replace(/[^a-zA-Z0-9]/g, '')
  return clean.slice(0, 2).toUpperCase() || '??'
}

/** Chain chip with the full chain name. The accent is reserved for the active chain state. */
export function ChainPill({
  chain,
  active = false,
  className = '',
}: {
  chain: ChainKey
  active?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        active ? 'border-accent/25 bg-accent-soft text-accent-ink' : 'border-line bg-paper-50 text-ink-500'
      } ${className}`}
    >
      <ChainMark chain={chain} />
      {CHAIN_LABELS[chain]}
    </span>
  )
}

export const ChainBadge = ChainPill

/**
 * Compact chain picker for a ticket side. The arrow in the ticket flips the
 * ordered pair; this selects either side's chain directly (including Sepolia).
 */
export function ChainSelect({
  chain,
  label,
  onSelect,
  disabled = false,
}: {
  chain: TradingChainKey
  label: string
  onSelect: (chain: TradingChainKey) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative min-w-0 shrink-0" ref={root} title={`${label} chain: ${CHAIN_LABELS[chain]}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} chain`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-paper-0 py-1.5 pl-2 pr-2.5 text-[11px] font-medium text-ink-700 transition-colors hover:bg-paper-100 disabled:opacity-50"
      >
        <ChainMark chain={chain} className="h-3.5 w-3.5" />
        <span className="truncate">{CHAIN_LABELS[chain]}</span>
        <ChevronDown {...icon} className={`h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={`${label} chain`}
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-[218px] rounded-2xl border border-line bg-paper-0 p-1.5 shadow-[0_18px_45px_rgba(24,24,27,0.12)]"
        >
          <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-400">{label} chain</p>
          {TRADING_CHAIN_KEYS.map((key) => {
            const selected = key === chain
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(key)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-[12px] transition-colors hover:bg-paper-100 ${
                  selected ? 'bg-accent-soft/40 text-accent' : 'text-ink-800'
                }`}
              >
                <ChainMark chain={key} className="h-4 w-4" />
                <span className="flex-1 truncate font-medium">{CHAIN_LABELS[key]}</span>
                {selected && <Check {...icon} className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ExternalLink({
  href,
  children,
  className = '',
  title,
}: {
  href?: string | null
  children: ReactNode
  className?: string
  title?: string
}) {
  if (!href) return <span className={`text-ink-400 ${className}`}>{children}</span>
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex items-center gap-1 text-ink-700 underline decoration-line underline-offset-2 transition-colors hover:text-accent ${className}`}
    >
      {children}
      <ArrowUpRight {...icon} />
    </a>
  )
}

export function TxLink({
  chain,
  hash,
  label,
  className = '',
}: {
  chain: ChainKey
  hash?: string | null
  label?: string
  className?: string
}) {
  if (!hash) return <span className="text-ink-400">—</span>
  return (
    <ExternalLink
      href={txUrl(chain, hash)}
      title={hash}
      className={`font-mono text-[11px] ${className}`}
    >
      {label ?? truncate(hash, 10, 8)}
    </ExternalLink>
  )
}

export function CopyButton({
  text,
  label = 'Copy',
  className = '',
}: {
  text: string
  label?: string
  className?: string
}) {
  const { copied, setCopied } = useCopyFeedback()
  return (
    <Button
      variant="quiet"
      size="sm"
      icon={<Copy {...icon} />}
      className={className}
      onClick={async () => {
        const ok = await copyText(text)
        setCopied(ok ? label : 'failed')
      }}
    >
      {copied === label ? 'Copied' : copied === 'failed' ? 'Try again' : label}
    </Button>
  )
}

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-paper-50 px-6 py-14 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-paper-0 text-ink-400">
        <Inbox {...icon} />
      </div>
      <p className="text-sm font-medium text-ink-900">{title}</p>
      {message && <p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-500">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line border-t-accent ${className}`}
      role="status"
      aria-label="Loading"
    />
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
      <span className="mb-2 flex items-baseline justify-between gap-3 text-xs font-medium text-ink-700">
        <span>{label}</span>
        {hint && <span className="text-[11px] font-normal text-ink-400">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-line bg-paper-0 px-3 py-2.5 font-mono text-xs text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:opacity-50'
