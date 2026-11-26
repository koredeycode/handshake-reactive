import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { ArrowUpRight, RefreshCw } from 'lucide-react'
import { CHAIN_IDS, addressUrl } from '../lib/chains'
import { useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import { countdown, formatAmount, formatDeadline, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { useProof } from '../lib/proofs'
import { useLeg, useOrder, useTokenMeta } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import { useNow } from '../lib/useNow'
import HopTimeline from './HopTimeline'
import LegCard from './LegCard'
import WriteButton, { type TxNotice } from './WriteButton'
import { Button, CopyButton, EmptyState, ExternalLink, Metric, Panel, Spinner, StatusPill, TxLink, icon } from './ui'

export default function OrderDetail({ orderId }: { orderId: Hex }) {
  const navigate = useNavigate()
  const config = useConfig()
  const { data: order, isLoading, isError, refetch: refetchOrder } = useOrder(orderId)
  const { data: proof, refetch: refetchProof } = useProof(orderId)
  const paymentLeg = useLeg('payment', orderId)
  const assetLeg = useLeg('asset', orderId, order?.seller)
  const paymentMeta = useTokenMeta('payment')
  const assetMeta = useTokenMeta('asset')
  const now = useNow()
  const [notice, setNotice] = useState<TxNotice | null>(null)
  const { writeContractAsync, isPending } = useWriteContract()
  const lasnaClient = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null

  function refresh() {
    void refetchOrder()
    void refetchProof()
    void paymentLeg.refetch()
    void assetLeg.refetch()
  }

  async function retry() {
    try {
      const hash = await writeContractAsync({
        address: config.reactive.reactiveContract as Address,
        abi: reactiveAbi,
        functionName: 'retry',
        args: [orderId],
      })
      setNotice({ label: 'Retry settlement', hash, chain: 'lasna', status: 'pending' })
      await lasnaClient?.waitForTransactionReceipt({ hash })
      setNotice({ label: 'Retry settlement', hash, chain: 'lasna', status: 'confirmed' })
      refresh()
    } catch {
      setNotice({ label: 'Retry settlement', hash: '0x', chain: 'lasna', status: 'error' })
    }
  }

  if (!config.reactive.reactiveContract) {
    return <EmptyState title="Order unavailable" message="No settlement contract is configured for this workspace." />
  }
  if (isLoading) {
    return (
      <Panel>
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
          <Spinner /> Loading order
        </div>
      </Panel>
    )
  }
  if (isError || !order) {
    return (
      <EmptyState
        title="Order not found"
        message="Check the order ID and try again."
        action={<Button onClick={() => navigate('/orders')}>Back to orders</Button>}
      />
    )
  }

  const status = deriveStatus(order, now)
  const canRetry = (order.paymentSeen || order.assetSeen) && !(order.paymentClosed && order.assetClosed)

  return (
    <div className="space-y-6">
      <Panel
        title={`Order ${truncate(orderId, 12, 8)}`}
        subtitle="Cross-chain OTC settlement"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            <Button
              size="sm"
              icon={<RefreshCw {...icon} />}
              onClick={refresh}
            >
              Refresh
            </Button>
            <CopyButton
              text={`${window.location.origin}/verify/${orderId}`}
              label="Copy link"
            />
            <Button
              size="sm"
              icon={<ArrowUpRight {...icon} />}
              onClick={() => navigate(`/verify/${orderId}`)}
            >
              Track order
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Buyer"
            value={truncate(order.buyer, 8, 6)}
            hint={<ExternalLink href={addressUrl('base', order.buyer)} className="text-[11px]">BaseScan</ExternalLink>}
          />
          <Metric
            label="Seller"
            value={truncate(order.seller, 8, 6)}
            hint={<ExternalLink href={addressUrl('unichain', order.seller)} className="text-[11px]">Uniscan</ExternalLink>}
          />
          <Metric
            label="Payment"
            value={formatAmount(order.paymentAmount, paymentMeta.data?.decimals ?? 6, paymentMeta.data?.symbol)}
            hint="Base Sepolia"
          />
          <Metric
            label="Asset"
            value={formatAmount(order.assetAmount, assetMeta.data?.decimals ?? 18, assetMeta.data?.symbol)}
            hint="Unichain Sepolia"
          />
          <Metric label="Deadline" value={formatDeadline(order.deadline)} />
          <Metric label="Time remaining" value={countdown(order.deadline, now)} />
        </div>

        {notice && (
          <p className="mt-4 text-[11px]">
            {notice.status === 'error' ? (
              <span className="text-bad">The transaction did not complete. Try again.</span>
            ) : (
              <>
                <span className={notice.status === 'confirmed' ? 'text-good' : 'text-ink-500'}>
                  {notice.label} {notice.status === 'confirmed' ? 'confirmed' : 'submitted'}
                </span>
                {notice.hash !== '0x' && (
                  <span className="ml-2">
                    <TxLink chain={notice.chain} hash={notice.hash} />
                  </span>
                )}
              </>
            )}
          </p>
        )}

        {canRetry && (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <WriteButton targetChain="lasna" onClick={retry} disabled={isPending}>
              {isPending ? 'Submitting' : 'Retry settlement'}
            </WriteButton>
            <span className="text-[11px] text-ink-500">A leg is locked and settlement has not finished.</span>
          </div>
        )}
      </Panel>

      <HopTimeline order={order} proof={proof} />

      <div className="grid gap-6 xl:grid-cols-2">
        <LegCard
          kind="payment"
          order={order}
          leg={paymentLeg.data}
          orderId={orderId}
          notice={notice}
          setNotice={setNotice}
          refresh={refresh}
        />
        <LegCard
          kind="asset"
          order={order}
          leg={assetLeg.data}
          orderId={orderId}
          notice={notice}
          setNotice={setNotice}
          refresh={refresh}
        />
      </div>
    </div>
  )
}
