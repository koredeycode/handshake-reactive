import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { CHAIN_LABELS } from '../lib/chains'
import type { AssetOption } from '../lib/assetPairs'
import { truncate } from '../lib/format'
import { TokenMark, icon } from './ui'
import type { ChainKey } from '../lib/chains'

function same(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

/**
 * Compact asset listbox for one ticket side. Options come from tokens.json;
 * pair options that no deployed market settles are disabled with a quiet hint.
 */
export default function AssetPicker({
  chain,
  label,
  options,
  selectedAddress,
  onSelect,
}: {
  chain: ChainKey
  label: string
  options: AssetOption[]
  selectedAddress?: string | null
  onSelect: (address: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = options.find((option) => same(option.address, selectedAddress)) ?? options[0]

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
    <div className="relative min-w-0 shrink-0" ref={root}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} asset on ${CHAIN_LABELS[chain]}`}
        title={current ? `${current.name} · ${current.symbol} · ${current.decimals} decimals` : CHAIN_LABELS[chain]}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-paper-0 py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-paper-100"
      >
        <TokenMark
          symbol={current?.symbol}
          mark={current?.mark}
          color={current?.color}
          size="sm"
        />
        <span className="max-w-[88px] truncate text-[13px] font-medium text-ink-900">
          {current?.symbol ?? '—'}
        </span>
        <ChevronDown {...icon} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={`${label} asset on ${CHAIN_LABELS[chain]}`}
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-[268px] max-w-[calc(100vw-3rem)] rounded-2xl border border-line bg-paper-0 p-2 shadow-[0_18px_45px_rgba(24,24,27,0.12)]"
        >
          <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-400">
            {label} · {CHAIN_LABELS[chain]}
          </p>
          {options.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-ink-500">Token metadata is unavailable.</p>
          )}
          {options.map((option) => {
            const isSelected = same(option.address, selectedAddress)
            return (
              <button
                key={`${chain}:${option.address}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={!option.supported}
                disabled={!option.supported}
                title={option.supported ? undefined : 'No settlement market for this pair'}
                onClick={() => {
                  if (!option.supported) return
                  onSelect(option.address)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors ${
                  option.supported ? 'hover:bg-paper-100' : 'cursor-not-allowed opacity-60'
                }`}
              >
                <TokenMark symbol={option.symbol} mark={option.mark} color={option.color} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink-900">
                    {option.name} · {option.symbol}
                  </span>
                  <span className="tnum block truncate font-mono text-[10px] text-ink-400">
                    {option.decimals} decimals · {truncate(option.address, 6, 4)}
                  </span>
                  {!option.supported && (
                    <span className="block text-[10px] text-ink-400">No settlement market for this pair</span>
                  )}
                </span>
                {isSelected && <Check {...icon} className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
