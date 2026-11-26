import type { ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import type { ChainKey } from '../lib/chains'
import { ChainPill, TokenMark, icon } from './ui'

export interface TicketSide {
  symbol?: string | null
  chain: ChainKey
  amount: string
  onAmountChange?: (value: string) => void
  hint?: ReactNode
  kind?: 'payment' | 'asset'
  mark?: string | null
  color?: string | null
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
      className="tnum min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[30px] font-medium leading-tight text-ink-900 outline-none placeholder:text-ink-400/50 sm:text-[34px]"
    />
  )
  return (
    <div className="rounded-2xl border border-line bg-paper-50 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-500">{direction === 'pay' ? 'You pay' : 'You receive'}</span>
        <ChainPill chain={side.chain} />
      </div>
      <div className="mt-3 flex items-center gap-4">
        {amount}
        <span className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-paper-0 py-1.5 pl-1.5 pr-3">
          <TokenMark symbol={side.symbol} kind={side.kind} mark={side.mark} color={side.color} />
          <span className="text-[13px] font-medium text-ink-900">{side.symbol ?? '—'}</span>
        </span>
      </div>
      <div className="mt-3 min-h-4 text-[11px] text-ink-400">{side.hint}</div>
    </div>
  )
}

/** The swap-card shape: two token tiles, a precise connector, and one action area. */
export default function TradeTicket({
  pay,
  receive,
  footer,
}: {
  pay: TicketSide
  receive: TicketSide
  footer?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line bg-paper-0 p-4 sm:p-5">
      <AmountTile side={pay} direction="pay" />
      <div className="relative z-10 h-2">
        <span className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-paper-0 text-ink-700">
          <ArrowDown {...icon} />
        </span>
      </div>
      <AmountTile side={receive} direction="receive" />
      {footer && <div className="mt-4">{footer}</div>}
    </div>
  )
}
