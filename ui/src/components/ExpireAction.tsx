import { useEffect, useState } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS } from '../lib/chains'
import { configuredAddress, expireEnabled, useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import { formatDeadline, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { useOrder } from '../lib/queries'
import { expireCooldownRemaining } from '../lib/status'
import { classifyTxError, txToast, type ClassifiedTxError } from '../lib/toasts'
import { useNow } from '../lib/useNow'
import type { Order } from '../lib/types'
import ConfirmModal from './ConfirmModal'
import WriteButton from './WriteButton'
import { Notice } from './ui'

const LABEL = 'Request refund'

/**
 * FUTURE-ONLY recovery action for the post-Cron100 Reactive Contract. The ABI
 * item, RC address and `expire` selector all only exist after the redeploy.
 *
 * Two independent gates keep this off the live RC: the caller in OrderDetail
 * checks the on-chain flags (no decision, past deadline, unclosed leg) AND
 * `expireEnabled(config)`; this component repeats the cutover gate before any
 * write so no other caller can accidentally submit to the live RC.
 *
 * Self-contained: wallet connect / chain switch come from WriteButton, the write
 * and toast lifecycle mirror FaucetPage and OrderDetail, and the pending state
 * resolves when the API/SSE projection shows a refund decision or EXPIRED.
 */
export default function ExpireAction({ order, orderId }: { order: Order; orderId: Hex }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [awaitingIndex, setAwaitingIndex] = useState(false)
  const [inlineError, setInlineError] = useState<ClassifiedTxError | null>(null)
  const config = useConfig()
  const rc = configuredAddress(config.reactive.reactiveContract)
  const cutoverReady = expireEnabled(config)
  const now = useNow()
  const { data: liveOrder, refetch } = useOrder(orderId)
  const { writeContractAsync, isPending } = useWriteContract()
  const lasnaClient = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null

  // The order prop drives eligibility (OrderDetail owns that gate); the live
  // query is only used to notice the projection catching up after submission.
  const decisionReflected = Boolean(
    liveOrder?.refundRequested || liveOrder?.expired || order.refundRequested || order.expired,
  )
  const cooldown = expireCooldownRemaining(order, now)
  const busy = isPending || awaitingIndex

  useEffect(() => {
    if (awaitingIndex && decisionReflected) setAwaitingIndex(false)
  }, [awaitingIndex, decisionReflected])

  async function submit() {
    setConfirmOpen(false)
    // Defence in depth: never write to the live RC if a caller slipped past the
    // render gate. The new selector does not exist there and would revert.
    if (!rc || !cutoverReady) return
    setInlineError(null)
    let hash: Hex | undefined
    try {
      hash = await writeContractAsync({
        address: rc as Address,
        abi: reactiveAbi,
        functionName: 'expire',
        args: [orderId],
        chainId: CHAIN_IDS.lasna,
      })
      txToast(LABEL, hash, 'lasna', 'pending')
      await lasnaClient?.waitForTransactionReceipt({ hash })
      txToast(LABEL, hash, 'lasna', 'confirmed')
      // Confirmed on Lasna, but the refund is only visible once the indexer has
      // folded REFUND_REQUESTED / EXPIRED into the order projection.
      setAwaitingIndex(true)
    } catch (error) {
      // classifyTxError covers rejection, chain mismatch, RPC and reverts
      // (including UnknownOrder / DeadlineReached / CooldownActive).
      setInlineError(classifyTxError(error, 'lasna'))
      txToast(LABEL, hash ?? '0x', 'lasna', 'error', error)
    } finally {
      void refetch()
    }
  }

  if (!rc || !cutoverReady) return null

  if (decisionReflected) {
    return (
      <span role="status" className="text-[11px] leading-relaxed text-ink-500">
        Refund requested on-chain — awaiting escrow callbacks. This is not a guaranteed refund; watch the order status for the result.
      </span>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <WriteButton
        targetChain="lasna"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        title={cooldown > 0
          ? `Advisory: ~${cooldown}s since the last action in the public index. That timestamp is not the contract clock — the RC's 30-second cooldown is authoritative, so you may still try; an early call just reverts.`
          : 'Requests refund callbacks for the depositor(s). Permissionless and irreversible.'}
      >
        {busy ? awaitingIndex ? 'Awaiting index…' : 'Submitting…' : LABEL}
      </WriteButton>
      <span aria-live="polite" className="max-w-md text-[11px] leading-relaxed text-ink-500">
        {busy
          ? 'Transaction sent. Waiting for the public index to record the refund decision — this is not yet a completed refund.'
          : cooldown > 0
            ? `Advisory countdown: ~${cooldown}s since the last indexed action. It uses the index timestamp, not the contract clock — the RC's 30-second cooldown is authoritative, so this estimate never blocks the button.`
            : 'Permissionless: anyone can ask the RC to request refunds for the depositor(s). Cannot be undone and never available after a settlement decision.'}
      </span>
      {inlineError && (
        <Notice tone="bad" title={inlineError.title} className="w-full">
          {inlineError.message}
        </Notice>
      )}
      {confirmOpen && (
        <ConfirmModal
          title="Request a refund via expiry?"
          description="This is permissionless: any wallet can call it; the buyer's approval is not needed. It asks the Reactive Contract to request refund callbacks for this order's depositor(s). It cannot be undone, and it can never refund an order once a settlement decision exists — the action is only offered when no decision is recorded. The contract enforces a 30-second cooldown after its last action; any countdown shown above is advisory and uses the public index timestamp, not the contract clock."
          details={[
            { label: 'Action', value: 'Request refund (expire)' },
            { label: 'Order', value: truncate(orderId, 12, 10) },
            { label: 'Deadline', value: formatDeadline(order.deadline) },
            { label: 'On-chain decision', value: 'None recorded' },
            { label: 'Network', value: 'Reactive Lasna' },
          ]}
          gasNote="You pay lREACT gas on Reactive Lasna and it is not returned. This requests refunds on-chain; it is not a guaranteed refund — delivery depends on the escrow callbacks being processed."
          confirmLabel="Request refund"
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void submit()}
        />
      )}
    </div>
  )
}
