import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { CHAIN_IDS, EXPLORER_NAMES, addressUrl } from '../lib/chains'
import { configuredAddress, expireEnabled, useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import { countdown, dashIfMissing, formatAge, formatAmount, formatDeadline, formatTimestamp, isZeroAddress, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { buildCaseDetailsText, buildProofMarkdown, orderChainKeys, useProof } from '../lib/proofs'
import { useRealtime } from '../lib/RealtimeProvider'
import { useLeg, useOrder } from '../lib/queries'
import {
  canCancelOpenOrder,
  canExpireOrder,
  canRetrySettlement,
  deriveStatus,
  displayRefundReason,
  hasDecision,
  hasUnclosedSeenLeg,
  isOpenOrder,
  isOrderTerminal,
  refundEvidence,
  useOrderStatus,
} from '../lib/status'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { venueOfOrder } from '../lib/venue'
import { useNow } from '../lib/useNow'
import { txToast } from '../lib/toasts'
import ConfirmModal from './ConfirmModal'
import ExpireAction from './ExpireAction'
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
  Notice,
  Panel,
  Spinner,
  StatusPill,
  icon,
} from './ui'

export default function OrderDetail({ orderId }: { orderId: Hex }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sharedTx = searchParams.get('tx')
  const config = useConfig()
  const { address } = useAccount()
  const { data: order, isLoading, isError, refetch: refetchOrder } = useOrder(orderId)
  const proof = useProof(orderId)
  const liveStatus = useOrderStatus(order)
  const { lastEventAt } = useRealtime()
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
    let hash: Hex | undefined
    try {
      hash = await writeContractAsync({
        address: rc as Address,
        abi: reactiveAbi,
        functionName,
        args: [orderId],
      })
      txToast(label, hash, 'lasna', 'pending')
      await lasnaClient?.waitForTransactionReceipt({ hash })
      txToast(label, hash, 'lasna', 'confirmed')
      refresh()
    } catch (error) {
      txToast(label, hash ?? '0x', 'lasna', 'error', error)
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
      <EmptyState
        title="Order not found"
        message={sharedTx
          ? `This order may not be indexed yet. The shared transaction ${truncate(sharedTx, 8, 6)} was kept in the link — refresh in a moment, or check it on the public tracker.`
          : 'Check the order ID and try again. A just-created order can take a short while to appear in the public index.'}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => void refetchOrder()}>Try again</Button>
            <Button onClick={() => navigate('/orders')}>Back to orders</Button>
          </div>
        }
      />
    )
  }

  const status = liveStatus ?? deriveStatus(order, now)
  const reason = order.refundReason
  const shownReason = displayRefundReason(reason, refundEvidence(order, proof.data, {
    payment: paymentLeg.data,
    asset: assetLeg.data,
  }))
  const canRetry = canRetrySettlement(order)
  // Future-only: on-chain eligibility is necessary but NOT sufficient. The
  // VITE_EXPIRE_ENABLED flag plus a non-live RC address must both hold before a
  // stranded order is allowed to show the request-refund button.
  const canExpire = canExpireOrder(order, now) && expireEnabled(config)
  const decisionText = hasDecision(order)
    ? order.refundRequested
      ? 'A refund decision was recorded on Lasna.'
      : 'A settlement decision was recorded on Lasna.'
    : 'No on-chain decision has been observed.'
  const isBuyer = !!address && address.toLowerCase() === order.buyer.toLowerCase()
  const canCancel = canCancelOpenOrder(order, now, address)
  const paymentSymbol = paymentToken.symbol
  const assetSymbol = assetToken.symbol
  const paymentDecimals = paymentToken.decimals
  const assetDecimals = assetToken.decimals
  const caseDetails = buildCaseDetailsText(String(orderId), order, proof.data, chainKeys)
  const proofMarkdown = buildProofMarkdown(orderId, order, proof.data, chainKeys)

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
            <StatusPill
              status={status}
              reason={reason}
              order={order}
              proof={proof.data}
              legs={{ payment: paymentLeg.data, asset: assetLeg.data }}
            />
            <Button size="sm" icon={<RefreshCw {...icon} />} onClick={refresh}>Refresh</Button>
            <CopyButton text={proofMarkdown} label="Copy proof bundle" />
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

        {shownReason === 'cancelled' && (
          <Notice className="mt-6" title="Cancelled before the order matched">
            <p>
              The buyer cancelled this open order before any seller matched it. Any payment that had been locked is
              returned through the refund path, so this reads as “Refunded · Cancelled” rather than a red “Invalid” pill.
              Check the settlement trail for the actual refund hash.
            </p>
          </Notice>
        )}

        {(status === 'STALLED' || status === 'REFUND_STALLED' || status === 'WAITING_FOR_EXPIRY') && (
          <Notice
            className="mt-6"
            tone={status === 'WAITING_FOR_EXPIRY' ? 'warn' : 'bad'}
            title={status === 'STALLED' ? 'Needs attention — no decision on record' : status === 'REFUND_STALLED' ? 'Refund decision is taking longer than expected' : 'Past deadline — waiting for the expiry sweep'}
          >
            <p>
              {status === 'STALLED'
                ? 'The deadline has passed with no settlement or refund decision, and no open leg is recorded in the public index. An automatic sweep cannot act on a leg it cannot see.'
                : status === 'REFUND_STALLED'
                  ? 'A refund decision was recorded on-chain, but no terminal transaction has been indexed yet. This advisory timer uses the public index timestamp rather than the contract clock, so it cannot prove the refund is stuck. Retry is optional and only useful while the escrow callbacks remain unconfirmed; it re-requests the recorded decision and costs Lasna gas.'
                  : 'The deadline has passed and no decision has been emitted. An origin-chain leg is still open, so the automated deadline sweep can still release it.'}
            </p>
            <p className="mt-1">On-chain decision: {decisionText} {hasUnclosedSeenLeg(order) ? 'An unclosed leg is observed.' : 'No unclosed leg is observed.'}</p>
            <div className="mt-2">
              <CopyButton text={caseDetails} label="Copy case details" />
            </div>
          </Notice>
        )}

        {canExpire && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <ExpireAction order={order} orderId={orderId} />
          </div>
        )}

        {canRetry && (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <WriteButton
              targetChain="lasna"
              onClick={() => setConfirmAction('retry')}
              disabled={isPending}
              title="Retry re-requests the decision already recorded on Lasna. It cannot create a new refund and costs Lasna gas."
            >
              {isPending ? 'Submitting' : 'Retry settlement'}
            </WriteButton>
            <span className="max-w-md text-[11px] leading-relaxed text-ink-500">
              {order.refundRequested ? 'A refund decision exists and a leg is still open.' : 'A settlement decision exists and a leg is still open.'} Retry re-requests that decision; it costs gas and cannot create a new one.
            </span>
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

        <details className="mt-6 rounded-xl border border-line bg-paper-50 px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-ink-700">Advanced</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] text-ink-400">Order nonce</dt>
              <dd className="tnum mt-1 font-mono text-xs text-ink-700">{order.nonce.toString()}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-400">Payment request nonce</dt>
              <dd className="tnum mt-1 font-mono text-xs text-ink-700">{order.paymentRequestNonce.toString()}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-400">Asset request nonce</dt>
              <dd className="tnum mt-1 font-mono text-xs text-ink-700">{order.assetRequestNonce.toString()}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-400">Terms hash</dt>
              <dd className="tnum mt-1 break-all font-mono text-[11px] text-ink-700">{order.termsHash ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-400">Last action</dt>
              <dd className="tnum mt-1 font-mono text-xs text-ink-700">{formatTimestamp(order.lastActionTimestamp)}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-400">Last event age</dt>
              <dd className="tnum mt-1 font-mono text-xs text-ink-700">{formatAge(lastEventAt, now * 1000)}</dd>
            </div>
          </dl>
        </details>
      </Panel>

      <HopTimeline order={order} proof={proof.data} reason={reason} />

      <div className="grid gap-6 xl:grid-cols-2">
        <LegCard
          kind="payment"
          order={order}
          leg={paymentLeg.data}
          orderId={orderId}
          refresh={refresh}
          reason={reason}
          refundTxHash={proof.data?.paymentRefunded?.txHash}
        />
        <LegCard
          kind="asset"
          order={order}
          leg={assetLeg.data}
          orderId={orderId}
          refresh={refresh}
          reason={reason}
          refundTxHash={proof.data?.assetRefunded?.txHash}
        />
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction === 'cancel' ? 'Cancel this open order?' : 'Retry settlement?'}
          description={confirmAction === 'cancel'
            ? 'Cancellation is irreversible and releases the payment lock path.'
            : 'Re-requests the settlement or refund decision already recorded on Lasna. It cannot create a new decision and costs gas.'}
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
