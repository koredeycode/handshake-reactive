import { useTokenDisplay } from '../lib/tokenDisplay'
import { ChainName, ConvergenceMark } from './ui'

/**
 * Compact, user-facing explanation of the one deployed direction. The reverse
 * direction is not configured and is deliberately not advertised here.
 */
export default function FlowExplainer() {
  const payment = useTokenDisplay('payment')
  const asset = useTokenDisplay('asset')

  return (
    <div className="rounded-2xl border border-line bg-paper-50 px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-900">
        <span className="flex h-5 w-5 items-center justify-center rounded-lg border border-line bg-paper-0 text-ink-500">
          <ConvergenceMark className="h-3.5 w-3.5" />
        </span>
        How this trade works
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
        <span className="font-medium text-ink-700">Buyer</span> creates the order and locks{' '}
        <span className="font-mono text-ink-700">{payment.symbol}</span> on <ChainName chain="base" />.{' '}
        <span className="font-medium text-ink-700">Seller</span> locks{' '}
        <span className="font-mono text-ink-700">{asset.symbol}</span> on <ChainName chain="unichain" />.
        One decision on <ChainName chain="lasna" /> releases both legs.
      </p>
    </div>
  )
}
