import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import OrderBoard from '../components/OrderBoard'
import TradeTicket from '../components/TradeTicket'
import { Button, ConvergenceMark, RouteStrip, icon } from '../components/ui'
import { useTicketAssetPairs } from '../lib/assetPairs'
import { CHAIN_LABELS } from '../lib/chains'
import { toUnitString } from '../lib/format'
import { useErc20Balance } from '../lib/queries'
import { useTradeTicket } from '../lib/tradeTicket'

export default function OrdersPage() {
  const navigate = useNavigate()
  const { address } = useAccount()
  const ticket = useTradeTicket()
  const {
    paymentOptions,
    assetOptions,
    setPaymentChain,
    setAssetChain,
  } = useTicketAssetPairs()

  const paymentToken = ticket.tokenFor('payment')
  const assetToken = ticket.tokenFor('asset')
  const paymentBalance = useErc20Balance(ticket.paymentChain, paymentToken?.address, address)
  const assetBalance = useErc20Balance(ticket.assetChain, assetToken?.address, address)

  function startTrade() {
    navigate('/new')
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

      <div className="grid grid-cols-1 items-start gap-6 min-w-0 xl:h-[calc(100vh-190px)] xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
        <section className="min-w-0 xl:sticky xl:top-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink-900">Trade ticket</h2>
            <span className="flex items-center gap-2 text-[11px] text-ink-400">
              <ConvergenceMark className="h-4 w-4" />
              Two legs, one decision
            </span>
          </div>
          <TradeTicket
            pay={{
              symbol: paymentToken?.symbol,
              chain: ticket.paymentChain,
              amount: ticket.payAmount,
              onAmountChange: ticket.setPayAmount,
              kind: 'payment',
              mark: paymentToken?.mark,
              color: paymentToken?.color,
              assetOptions: paymentOptions,
              selectedAddress: paymentToken?.address,
              onAssetChange: (token) => ticket.selectToken('payment', token),
              onChainChange: setPaymentChain,
              tokenAddress: paymentToken?.address,
              verified: paymentToken?.verified,
              hint: paymentBalance.data !== undefined && paymentBalance.data !== null
                ? `${paymentToken?.name} · balance ${toUnitString(paymentBalance.data, paymentToken?.decimals ?? 18)} ${paymentToken?.symbol}`
                : `${paymentToken?.name ?? 'Token'} · ${CHAIN_LABELS[ticket.paymentChain]} testnet`,
            }}
            receive={{
              symbol: assetToken?.symbol,
              chain: ticket.assetChain,
              amount: ticket.receiveAmount,
              onAmountChange: ticket.setReceiveAmount,
              kind: 'asset',
              mark: assetToken?.mark,
              color: assetToken?.color,
              assetOptions: assetOptions,
              selectedAddress: assetToken?.address,
              onAssetChange: (token) => ticket.selectToken('asset', token),
              onChainChange: setAssetChain,
              tokenAddress: assetToken?.address,
              verified: assetToken?.verified,
              hint: assetBalance.data !== undefined && assetBalance.data !== null
                ? `${assetToken?.name} · balance ${toUnitString(assetBalance.data, assetToken?.decimals ?? 18)} ${assetToken?.symbol}`
                : `${assetToken?.name ?? 'Token'} · ${CHAIN_LABELS[ticket.assetChain]} testnet`,
            }}
            onReverse={ticket.flip}
            footer={
              <>
                <Button variant="primary" className="w-full" icon={<Plus {...icon} />} onClick={startTrade}>
                  New trade
                </Button>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
                  Amounts, chains and tokens carry over to the trade form. Nothing is submitted until you sign.
                </p>
              </>
            }
          />
        </section>

        <div className="min-h-0 min-w-0 xl:h-full">
          <OrderBoard scrollable />
        </div>
      </div>
    </div>
  )
}
