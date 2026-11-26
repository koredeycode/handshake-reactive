import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { ChainMark, icon } from './ui'
import { chainKeyFromId, useMarket, type Market } from '../lib/markets'

/** Compact market control: two role chain marks + the market label. */
export default function MarketSelector() {
  const { market, markets, setMarket } = useMarket()
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

  if (!market) return null

  const Marks = ({ entry }: { entry: Market }) => (
    <span className="flex shrink-0 items-center -space-x-1">
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line bg-paper-0">
        <ChainMark chain={chainKeyFromId(entry.payment.chainId, entry.payment.chainKey)} className="h-3 w-3" />
      </span>
      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line bg-paper-0">
        <ChainMark chain={chainKeyFromId(entry.asset.chainId, entry.asset.chainKey)} className="h-3 w-3" />
      </span>
    </span>
  )

  return (
    <div className="relative min-w-0" ref={root}>
      <button
        type="button"
        aria-label={`Market: ${market.label}`}
        aria-haspopup={markets.length > 1 ? 'listbox' : undefined}
        aria-expanded={markets.length > 1 ? open : undefined}
        title={market.label}
        onClick={() => markets.length > 1 && setOpen((value) => !value)}
        className="flex min-w-0 max-w-[210px] items-center gap-2 rounded-xl border border-line bg-paper-0 px-2 py-1.5 text-[11px] text-ink-700 transition-colors hover:bg-paper-100 sm:max-w-[280px]"
      >
        <Marks entry={market} />
        <span className="min-w-0 truncate font-medium">{market.label}</span>
        {markets.length > 1 && (
          <ChevronDown {...icon} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && markets.length > 1 && (
        <div
          role="listbox"
          aria-label="Markets"
          className="absolute right-0 top-full z-40 mt-2 w-[300px] rounded-2xl border border-line bg-paper-0 p-1.5 shadow-[0_18px_45px_rgba(24,24,27,0.12)]"
        >
          {markets.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={entry.id === market.id}
              onClick={() => {
                setMarket(entry.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] transition-colors hover:bg-paper-100 ${
                entry.id === market.id ? 'font-medium text-accent-ink' : 'text-ink-700'
              }`}
            >
              <Marks entry={entry} />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.id === market.id && <Check {...icon} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
