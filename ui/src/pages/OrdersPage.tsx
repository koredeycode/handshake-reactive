import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import OrderBoard from '../components/OrderBoard'
import TradeTicket from '../components/TradeTicket'
import { Button, ConvergenceMark, RouteStrip, icon } from '../components/ui'
import { useAccount } from 'wagmi'
import { CHAIN_LABELS } from '../lib/chains'
import { toUnitString } from '../lib/format'
import { useMarket } from '../lib/markets'
import { useTokenBalance } from '../lib/queries'
import { useTokenDisplay } from '../lib/tokenDisplay'

export default function OrdersPage() {
  const navigate = useNavigate()
  const { address } = useAccount()
  const { chainKeyFor, market } = useMarket()
  const paymentChain = chainKeyFor('payment')
  const assetChain = chainKeyFor('asset')
  const paymentToken = useTokenDisplay('payment')
  const assetToken = useTokenDisplay('asset')
  const paymentBalance = useTokenBalance('payment', address)
  const assetBalance = useTokenBalance('asset', address)
  const [pay, setPay] = useState('')
  const [receive, setReceive] = useState('')

  const paymentSymbol = paymentToken.symbol
  const assetSymbol = assetToken.symbol
  const paymentDecimals = paymentToken.decimals
  const assetDecimals = assetToken.decimals

  function startTrade() {
    const params = new URLSearchParams()
    if (market) params.set('market', market.id)
    if (pay.trim()) params.set('pay', pay.trim())
    if (receive.trim()) params.set('get', receive.trim())
    const query = params.toString()
    navigate(`/new${query ? `?${query}` : ''}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-ink-900">Trade</h1>
          <p className="mt-1 text-xs text-ink-500">Cross-chain OTC settlement for traders and market makers</p>
        </div>
        <RouteStrip />
      </div>

      <div className="grid items-start gap-6 xl:h-[calc(100vh-190px)] xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        <section className="xl:sticky xl:top-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink-900">Trade ticket</h2>
            <span className="flex items-center gap-2 text-[11px] text-ink-400">
              <ConvergenceMark className="h-4 w-4" />
              Two legs, one decision
            </span>
          </div>
          <TradeTicket
            pay={{
              symbol: paymentSymbol,
              chain: paymentChain,
              amount: pay,
              onAmountChange: setPay,
              kind: 'payment',
              mark: paymentToken.mark,
              color: paymentToken.color,
              hint: paymentBalance.data !== undefined && paymentBalance.data !== null
                ? `${paymentToken.name} · balance ${toUnitString(paymentBalance.data, paymentDecimals)} ${paymentSymbol}`
                : `${paymentToken.name} · ${CHAIN_LABELS[paymentChain]} testnet`,
            }}
            receive={{
              symbol: assetSymbol,
              chain: assetChain,
              amount: receive,
              onAmountChange: setReceive,
              kind: 'asset',
              mark: assetToken.mark,
              color: assetToken.color,
              hint: assetBalance.data !== undefined && assetBalance.data !== null
                ? `${assetToken.name} · balance ${toUnitString(assetBalance.data, assetDecimals)} ${assetSymbol}`
                : `${assetToken.name} · ${CHAIN_LABELS[assetChain]} testnet`,
            }}
            footer={
              <>
                <Button variant="primary" className="w-full" icon={<Plus {...icon} />} onClick={startTrade}>
                  New trade
                </Button>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
                  Amounts carry over to the trade form. Nothing is submitted until you sign.
                </p>
              </>
            }
          />
        </section>

        <div className="min-h-0 xl:h-full">
          <OrderBoard scrollable />
        </div>
      </div>
    </div>
  )
}
