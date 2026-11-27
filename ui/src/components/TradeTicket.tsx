import type { ReactNode } from 'react'
import { ArrowDown, ArrowUpDown } from 'lucide-react'
import { CHAIN_LABELS, type TradingChainKey } from '../lib/chains'
import type { ChainTokenOption, TokenSelection } from '../lib/tokenDisplay'
import { UNVERIFIED_LABEL } from '../lib/tradeTicket'
import type { TicketKind } from '../lib/tradeTicket'
import AssetPicker from './AssetPicker'
import { ChainPill, ChainSelect, TokenMark, icon } from './ui'

export interface TicketSide {
  symbol?: string | null
  chain: TradingChainKey
  amount: string
  onAmountChange?: (value: string) => void
  hint?: ReactNode
  kind?: TicketKind
  mark?: string | null
  color?: string | null
  /** Curated + confirmed custom options; shown only on trade entry screens. */
  assetOptions?: ChainTokenOption[]
  selectedAddress?: string | null
  onAssetChange?: (token: TokenSelection) => void
  onChainChange?: (chain: TradingChainKey) => void
  /** Full address of a custom token, shown next to the pill when selected. */
  tokenAddress?: string | null
  verified?: boolean
}

function AmountTile({ side, direction }: { side: TicketSide; direction: 'pay' | 'receive' }) {
  const amount = (
    <input
      inputMode="decimal"
      value={side.amount}
      onChange={side.onAmountChange ? (event) => side.onAmountChange!(event.target.value) : undefined}
      readOnly={!side.onAmountChange}
      placeholder="0.00"
      aria-label={direction === 'pay' ? 'Pay amount' : 'Receive amount'}
      size={1}
      className="tnum w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[30px] font-medium leading-tight text-ink-900 outline-none placeholder:text-ink-400/50 sm:text-[34px]"
    />
  )
  const picker = side.onAssetChange && side.assetOptions
  return (
    <div className="rounded-2xl border border-line bg-paper-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-500">{direction === 'pay' ? 'Payment leg' : 'Asset leg'}</span>
        <div className="flex items-center gap-1.5">
          {picker ? (
            <ChainSelect
              chain={side.chain}
              label={direction === 'pay' ? 'Pay' : 'Receive'}
              onSelect={side.onChainChange ?? (() => {})}
            />
          ) : (
            <ChainPill chain={side.chain} />
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4">
        {amount}
        {picker ? (
          <AssetPicker
            chain={side.chain}
            kind={side.kind ?? 'payment'}
            label={direction === 'pay' ? 'Pay' : 'Receive'}
            options={side.assetOptions ?? []}
            selectedAddress={side.selectedAddress}
          />
        ) : (
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-paper-0 py-1.5 pl-1.5 pr-3">
            <TokenMark symbol={side.symbol} kind={side.kind} mark={side.mark} color={side.color} />
            <span className="text-[13px] font-medium text-ink-900">{side.symbol ?? '—'}</span>
          </span>
        )}
      </div>
      <div className="mt-3 min-h-4 text-[11px] text-ink-400">
        {side.hint}
        {side.tokenAddress && !side.verified && (
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="rounded-full border border-warn/25 bg-warn-soft px-1.5 py-0.5 text-[9px] text-warn">
              {UNVERIFIED_LABEL}
            </span>
            <span className="tnum font-mono" title={side.tokenAddress}>{side.tokenAddress}</span>
          </span>
        )}
      </div>
      {picker && (
        <p className="mt-1 text-[10px] text-ink-400">Chain: {CHAIN_LABELS[side.chain]}</p>
      )}
    </div>
  )
}

/** The swap-card shape: two token tiles, a precise connector, and one action area. */
export default function TradeTicket({
  pay,
  receive,
  footer,
  onReverse,
}: {
  pay: TicketSide
  receive: TicketSide
  footer?: ReactNode
  onReverse?: () => void
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper-0 p-4 sm:p-5">
      <AmountTile side={pay} direction="pay" />
      <div className="relative z-10 flex h-11 items-center justify-center">
        {onReverse ? (
          <button
            type="button"
            onClick={onReverse}
            aria-label="Reverse trade direction"
            title="Reverse trade direction"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-paper-0 text-ink-700 transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent-ink"
          >
            <ArrowUpDown {...icon} />
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper-0 text-ink-700"
          >
            <ArrowDown {...icon} />
          </span>
        )}
      </div>
      <AmountTile side={receive} direction="receive" />
      {footer && <div className="mt-4">{footer}</div>}
    </div>
  )
}
