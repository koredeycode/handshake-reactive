import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { CHAIN_IDS, EXPLORER_NAMES, addressUrl } from '../lib/chains'
import { configuredAddress, useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import { countdown, dashIfMissing, formatAmount, formatDeadline, isZeroAddress, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { orderChainKeys, useProof } from '../lib/proofs'
import { useLeg, useOrder } from '../lib/queries'
import { canCancelOpenOrder, deriveStatus, isOpenOrder, isOrderTerminal } from '../lib/status'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { venueOfOrder } from '../lib/venue'
import { useNow } from '../lib/useNow'
import { txToast } from '../lib/toasts'
import ConfirmModal from './ConfirmModal'
import FlowExplainer from './FlowExplainer'
import HopTimeline from './HopTimeline'
import LegCard from './LegCard'
import TradeTicket from './TradeTicket'
import WriteButton from './WriteButton'
import {
  Button,
  CopyButton,
  EmptyState,
  ExternalLink,
  Metric,
  Panel,
  Spinner,
  StatusPill,
  icon,
} from './ui'

export default function OrderDetail({ orderId }: { orderId: Hex }) {
  const navigate = useNavigate()
  const config = useConfig()
  const { address } = useAccount()
  const { data: order, isLoading, isError, refetch: refetchOrder } = useOrder(orderId)
  const proof = useProof(orderId)
  const open = isOpenOrder(order)
  const winnerKnown = !!order?.winner && !isZeroAddress(order.winner)
  // Race legs are keyed by seller: show the winner's leg, or this wallet's own.
  const raceSeller = open ? (winnerKnown ? order!.winner : address ?? order?.seller) : order?.seller
  const paymentVenue = order ? venueOfOrder(order, 'payment') : null
  const assetVenue = order ? venueOfOrder(order, 'asset') : null
  const settled = isOrderTerminal(order)
  const paymentLeg = useLeg('payment', orderId, undefined, paymentVenue, settled)
  const assetLeg = useLeg('asset', orderId, raceSeller, assetVenue, settled)
  const paymentToken = useOrderTokenDisplay(order, 'payment')
  const assetToken = useOrderTokenDisplay(order, 'asset')
  const metadataReady = paymentToken.metadataReady && assetToken.metadataReady
  const chainKeys = orderChainKeys(order)
  const now = useNow()
  const [confirmAction, setConfirmAction] = useState<'retry' | 'cancel' | null>(null)
  const { writeContractAsync, isPending } = useWriteContract()
  const lasnaClient = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null

  function refresh() {
    void refetchOrder()
    void proof.refetch()
    void paymentLeg.refetch()
    void assetLeg.refetch()
  }

  async function send(label: string, functionName: 'cancelOrder' | 'retry') {
    const rc = configuredAddress(config.reactive.reactiveContract)
    if (!rc) return
    try {
      const hash = await writeContractAsync({
        address: rc as Address,
        abi: reactiveAbi,
        functionName,
        args: [orderId],
      })
      txToast(label, hash, 'lasna', 'pending')
      await lasnaClient?.waitForTransactionReceipt({ hash })
      txToast(label, hash, 'lasna', 'confirmed')
      refresh()
    } catch {
      txToast(label, '0x', 'lasna', 'error')
    }
  }

  if (!configuredAddress(config.reactive.reactiveContract)) {
    return <EmptyState title="Order unavailable" message="No reactive contract is configured for this workspace." />
  }
  if (isLoading) {
    return (
      <Panel>
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500"><Spinner /> Loading order</div>
      </Panel>
    )
  }
  if (isError || !order) {
    return (
      <EmptyState title="Order not found" message="Check the order ID and try again." action={<Button onClick={() => navigate('/orders')}>Back to orders</Button>} />
    )
  }

  const status = deriveStatus(order, now)
  const canRetry = (order.paymentSeen || order.assetSeen) && !(order.paymentClosed && order.assetClosed)
  const isBuyer = !!address && address.toLowerCase() === order.buyer.toLowerCase()
  const canCancel = canCancelOpenOrder(order, now, address)
  const paymentSymbol = paymentToken.symbol
  const assetSymbol = assetToken.symbol
  const paymentDecimals = paymentToken.decimals
  const assetDecimals = assetToken.decimals

  return (
    <div className="space-y-6">
      <Panel
        title={`Order ${truncate(orderId, 12, 8)}`}
        subtitle="Cross-chain OTC settlement"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {open && (
              <span className="rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent-ink">
                Open order
              </span>
            )}
            <StatusPill status={status} />
            <Button size="sm" icon={<RefreshCw {...icon} />} onClick={refresh}>Refresh</Button>
            <CopyButton text={`${window.location.origin}/verify/${orderId}`} label="Copy link" />
            <Button size="sm" icon={<ArrowUpRight {...icon} />} onClick={() => navigate(`/verify/${orderId}`)}>
              Track order
            </Button>
          </div>
        }
        bodyClass="p-6"
      >
        <TradeTicket
          pay={{
            symbol: paymentSymbol,
            chain: chainKeys.payment,
            kind: 'payment',
            mark: paymentToken.mark,
            color: paymentToken.color,
            amount: dashIfMissing(order.missing?.paymentAmount, formatAmount(order.paymentAmount, paymentDecimals)),
            tokenAddress: paymentToken.address,
            verified: paymentToken.verified,
            loading: !metadataReady,
            hint: `${paymentToken.name} · payment leg on ${paymentToken.chainLabel}`,
          }}
          receive={{
            symbol: assetSymbol,
            chain: chainKeys.asset,
            kind: 'asset',
            mark: assetToken.mark,
            color: assetToken.color,
            amount: dashIfMissing(order.missing?.assetAmount, formatAmount(order.assetAmount, assetDecimals)),
            tokenAddress: assetToken.address,
            verified: assetToken.verified,
            loading: !metadataReady,
            hint: `${assetToken.name} · asset leg on ${assetToken.chainLabel}`,
          }}
        />

        <div className="mt-5"><FlowExplainer order={order} /></div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Buyer"
            value={dashIfMissing(order.missing?.buyer, truncate(order.buyer, 8, 6))}
            hint={!order.missing?.buyer && <ExternalLink href={addressUrl(chainKeys.payment, order.buyer)} className="inline-flex min-h-10 items-center text-[12px]">{EXPLORER_NAMES[chainKeys.payment]}</ExternalLink>}
          />
          <Metric
            label="Seller"
            value={open ? 'Open to any seller' : dashIfMissing(order.missing?.seller, truncate(order.seller, 8, 6))}
            hint={!open && !order.missing?.seller && <ExternalLink href={addressUrl(chainKeys.asset, order.seller)} className="inline-flex min-h-10 items-center text-[12px]">{EXPLORER_NAMES[chainKeys.asset]}</ExternalLink>}
          />
          {open && (
            <>
              <Metric
                label={winnerKnown ? 'Winner' : 'Leaderboard'}
                value={winnerKnown ? (
                  <ExternalLink href={addressUrl(chainKeys.asset, order.winner)} className="inline-flex min-h-10 items-center text-[12px]">
                    {truncate(order.winner, 8, 6)}
                  </ExternalLink>
                ) : (
                  `${order.assetLockCount.toString()} ${order.assetLockCount === 1n ? 'lock' : 'locks'}`
                )}
                hint={winnerKnown ? `${order.assetLockCount.toString()} total locks` : 'First valid lock wins'}
              />
              <Metric label="Matches" value={order.assetLockCount.toString()} />
            </>
          )}
          <Metric label="Deadline" value={formatDeadline(order.deadline)} />
          <Metric
            label="Time remaining"
            value={<span className={status === 'READY' || status === 'SETTLING' ? 'text-accent' : ''}>{countdown(order.deadline, now)}</span>}
          />
        </div>

        {canRetry && (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <WriteButton targetChain="lasna" onClick={() => setConfirmAction('retry')} disabled={isPending}>
              {isPending ? 'Submitting' : 'Retry settlement'}
            </WriteButton>
            <span className="text-[11px] text-ink-500">A leg is locked and settlement has not finished.</span>
          </div>
        )}

        {open && isBuyer && (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <WriteButton
              targetChain="lasna"
              onClick={() => setConfirmAction('cancel')}
              disabled={isPending || !canCancel}
              title={canCancel ? undefined : 'Available while the order is unmatched and before the deadline.'}
            >
              {isPending ? 'Submitting' : 'Cancel order'}
            </WriteButton>
            <span className="text-[11px] text-ink-500">
              {canCancel ? 'Cancel this open order before a seller matches it.' : 'Available while the order is unmatched and before the deadline.'}
            </span>
          </div>
        )}
      </Panel>

      <HopTimeline order={order} proof={proof.data} />

      <div className="grid gap-6 xl:grid-cols-2">
        <LegCard kind="payment" order={order} leg={paymentLeg.data} orderId={orderId} refresh={refresh} />
        <LegCard kind="asset" order={order} leg={assetLeg.data} orderId={orderId} refresh={refresh} />
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction === 'cancel' ? 'Cancel this open order?' : 'Retry settlement?'}
          description={confirmAction === 'cancel'
            ? 'Cancellation is irreversible and releases the payment lock path.'
            : 'Requests settlement again from the reactive contract. This submits a transaction.'}
          details={[
            { label: 'Order', value: truncate(orderId, 12, 10) },
            { label: 'Action', value: confirmAction === 'cancel' ? 'Cancel order' : 'Retry settlement' },
            { label: 'Payment', value: `${dashIfMissing(order.missing?.paymentAmount, metadataReady ? formatAmount(order.paymentAmount, paymentDecimals, paymentSymbol) : '—')} · ${paymentToken.chainLabel}` },
            { label: 'Asset', value: `${dashIfMissing(order.missing?.assetAmount, metadataReady ? formatAmount(order.assetAmount, assetDecimals, assetSymbol) : '—')} · ${assetToken.chainLabel}` },
            { label: 'Counterparty', value: open ? 'Open to any seller' : dashIfMissing(order.missing?.seller, truncate(order.seller, 10, 8)) },
            { label: 'Deadline', value: formatDeadline(order.deadline) },
            { label: 'Network', value: 'Reactive Lasna' },
          ]}
          gasNote="You will pay gas on Reactive Lasna for this transaction. The backend never signs or holds your keys."
          confirmLabel={confirmAction === 'cancel' ? 'Cancel order' : 'Retry settlement'}
          busy={isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmAction
            setConfirmAction(null)
            void send(action === 'cancel' ? 'Cancel order' : 'Retry settlement', action === 'cancel' ? 'cancelOrder' : 'retry')
          }}
        />
      )}
    </div>
  )
}
