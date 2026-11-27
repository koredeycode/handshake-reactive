import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, ShieldAlert } from 'lucide-react'
import { useAccount } from 'wagmi'
import { CHAIN_LABELS, type TradingChainKey } from '../lib/chains'
import type { ChainTokenOption, TokenSelection } from '../lib/tokenDisplay'
import { curatedSelection } from '../lib/tokenDisplay'
import { truncate } from '../lib/format'
import { UNVERIFIED_LABEL, useCustomTokenLookup, useTradeTicket, type TicketKind } from '../lib/tradeTicket'
import { TokenMark, icon } from './ui'

function same(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

/**
 * Compact asset listbox for one ticket side. Curated tokens are verified;
 * pasted ERC-20s are fetched from chain, labelled unverified, and can only be
 * used after the user ticks an explicit confirmation checkbox.
 */
export default function AssetPicker({
  chain,
  label,
  kind,
  options,
  selectedAddress,
  onChange,
}: {
  chain: TradingChainKey
  label: string
  kind: TicketKind
  options: ChainTokenOption[]
  selectedAddress?: string | null
  onChange?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [input, setInput] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { address } = useAccount()
  const { confirmCustom, selectToken, isConfirmedCustom } = useTradeTicket()
  const lookup = useCustomTokenLookup(chain, input.trim(), address ?? null)
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

  const useCustom = () => {
    if (!lookup.token || !confirmed) return
    confirmCustom(kind, lookup.token)
    setInput('')
    setConfirmed(false)
    setCustomOpen(false)
    setOpen(false)
    onChange?.()
  }

  return (
    <div className="relative min-w-0 shrink-0" ref={root}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} asset on ${CHAIN_LABELS[chain]}`}
        title={current ? `${current.name} · ${current.symbol} · ${current.decimals} decimals · ${current.address}` : CHAIN_LABELS[chain]}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-paper-0 py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-paper-100"
      >
        <TokenMark symbol={current?.symbol} mark={current?.mark} color={current?.color} size="sm" />
        <span className="max-w-[88px] truncate text-[13px] font-medium text-ink-900">
          {current?.symbol ?? '—'}
        </span>
        <ChevronDown {...icon} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={`${label} asset on ${CHAIN_LABELS[chain]}`}
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-[292px] max-w-[calc(100vw-3rem)] rounded-2xl border border-line bg-paper-0 p-2 shadow-[0_18px_45px_rgba(24,24,27,0.12)]"
        >
          <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-400">
            {label} · {CHAIN_LABELS[chain]}
          </p>
          <div className="max-h-[220px] overflow-y-auto">
            {options.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-ink-500">Token metadata is unavailable.</p>
            )}
            {options.map((option) => {
              const isSelected = same(option.address, selectedAddress)
              const confirmedCustom = isConfirmedCustom(chain, option.address)
              return (
                <button
                  key={`${chain}:${option.address}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  title={`${option.name} · ${CHAIN_LABELS[chain]} · ${option.address}`}
                  onClick={() => {
                    const token: TokenSelection = curatedSelection(option)
                    if (confirmedCustom) confirmCustom(kind, token)
                    else selectToken(kind, token)
                    setOpen(false)
                    onChange?.()
                  }}
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-paper-100 ${
                    isSelected ? 'bg-accent-soft/40' : ''
                  }`}
                >
                  <TokenMark symbol={option.symbol} mark={option.mark} color={option.color} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="truncate text-[12px] font-medium text-ink-900">{option.symbol}</span>
                      {!option.verified && (
                        <span className="rounded-full border border-warn/25 bg-warn-soft px-1.5 py-0.5 text-[9px] text-warn">
                          {UNVERIFIED_LABEL}
                        </span>
                      )}
                    </span>
                    {!option.verified && (
                      <span className="tnum block truncate font-mono text-[10px] text-ink-400" title={option.address}>
                        {CHAIN_LABELS[chain]} · {option.address}
                      </span>
                    )}
                    <span className="tnum block truncate font-mono text-[10px] text-ink-400">
                      {option.name} · {option.decimals} decimals
                    </span>
                  </span>
                  {isSelected && <Check {...icon} className="shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>

          <div className="mt-2 border-t border-line pt-2">
            {!customOpen ? (
              <button
                type="button"
                onClick={() => setCustomOpen(true)}
                className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-[11px] text-ink-500 transition-colors hover:bg-paper-100 hover:text-accent"
              >
                <Plus {...icon} /> Add a custom ERC-20
              </button>
            ) : (
              <div className="space-y-2 px-1 pb-1">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-400">
                    Token address on {CHAIN_LABELS[chain]}
                  </span>
                  <input
                    className="w-full rounded-xl border border-line bg-paper-0 px-2.5 py-2 font-mono text-[11px] text-ink-900 outline-none placeholder:text-ink-400 focus:border-accent"
                    placeholder="0x…"
                    value={input}
                    onChange={(event) => {
                      setInput(event.target.value.trim())
                      setConfirmed(false)
                    }}
                    spellCheck={false}
                  />
                </label>

                {lookup.status === 'loading' && <p className="text-[11px] text-ink-500">Reading token metadata…</p>}
                {lookup.status === 'error' && (
                  <p className="flex items-start gap-1.5 text-[11px] text-bad"><ShieldAlert {...icon} />{lookup.error}</p>
                )}
                {lookup.status === 'ready' && lookup.token && (
                  <div className="rounded-xl border border-warn/25 bg-warn-soft/60 p-2.5">
                    <div className="flex items-center gap-2">
                      <TokenMark symbol={lookup.token.symbol} mark={lookup.token.mark} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-900">
                        {lookup.token.symbol}
                        <span className="ml-1.5 rounded-full border border-warn/30 bg-paper-0 px-1.5 py-0.5 text-[9px] text-warn">
                          {UNVERIFIED_LABEL}
                        </span>
                      </span>
                    </div>
                    <p className="tnum mt-2 break-all font-mono text-[10px] text-ink-500" title={lookup.token.address}>
                      {CHAIN_LABELS[chain]} · {lookup.token.address}
                    </p>
                    <p className="mt-1 text-[10px] text-ink-500">
                      {lookup.token.name} · {lookup.token.decimals} decimals
                      {lookup.balance !== null && ` · balance ${truncate(lookup.balance.toString(), 6, 4)}`}
                    </p>
                    <label className="mt-2 flex min-h-10 cursor-pointer items-start gap-2 text-[11px] leading-snug text-ink-700">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                      />
                      <span>I verified this contract address and want to use it as a leg. The metadata comes from the token itself.</span>
                    </label>
                    <button
                      type="button"
                      onClick={useCustom}
                      disabled={!confirmed}
                      className="mt-1.5 min-h-9 w-full rounded-lg bg-accent text-[11px] font-medium text-white disabled:opacity-50"
                    >
                      Use {lookup.token.symbol} on {CHAIN_LABELS[chain]}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCustomOpen(false)
                    setInput('')
                    setConfirmed(false)
                  }}
                  className="min-h-8 px-2 text-[11px] text-ink-400 hover:text-ink-700"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
