import { useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS, CHAIN_LABELS, addressUrl } from '../lib/chains'
import { assetEscrowAbi, erc20Abi, paymentEscrowAbi } from '../lib/contracts'
import { formatAmount, formatDeadline, isZeroAddress, truncate, ZERO_ADDRESS } from '../lib/format'
import { logClient } from '../lib/logs'
import { useAllowance, useErc20Balance, type LegKind } from '../lib/queries'
import { displayRefundReason, isOpenOrder, refundEvidence, refundReasonKey } from '../lib/status'
import { computeTermsHash } from '../lib/terms'
import { txErrorMessage, txToast } from '../lib/toasts'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { UNVERIFIED_LABEL } from '../lib/tradeTicket'
import { venueOfOrder } from '../lib/venue'
import type { Leg, Order } from '../lib/types'
import ConfirmModal from './ConfirmModal'
import WriteButton from './WriteButton'
import { ChainPill, ExternalLink, Notice, Skeleton, TokenMark, TxLink } from './ui'

function stateLabel(state?: bigint | null): string {
  if (state === undefined || state === null) return 'Not locked'
  return ['Not locked', 'Locked', 'Released', 'Refunded'][Number(state)] ?? 'Locked'
}

export default function LegCard({
  kind,
  order,
  leg,
  orderId,
  refresh,
  reason,
  refundTxHash,
}: {
  kind: LegKind
  order: Order
  leg?: Leg | null
  orderId: Hex
  refresh: () => void
  reason?: string | null
  refundTxHash?: string
}) {
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'approve' | 'lock' | null>(null)

  // Every chain, escrow, token and decimal comes from THIS order's venue.
  const venue = venueOfOrder(order, kind)
  const chainKey = venue.chainKey
  const escrow = venue.escrow
  const display = useOrderTokenDisplay(order, kind)
  const metadataReady = display.metadataReady
  const client = logClient(usePublicClient({ chainId: CHAIN_IDS[chainKey] })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null
  const balance = useErc20Balance(chainKey, venue.token, address)
  const allowance = useAllowance(chainKey, venue.token, escrow, address)

  const isPayment = kind === 'payment'
  const open = isOpenOrder(order)
  const amount = isPayment ? order.paymentAmount : order.assetAmount
  const expectedToken = isPayment ? order.paymentToken : order.assetToken
  const counterparty = isPayment ? order.seller : order.buyer
  const depositor = isPayment ? order.buyer : open ? address ?? ZERO_ADDRESS : order.seller
  const canLockByMe = !!address && (
    isPayment
      ? address.toLowerCase() === depositor.toLowerCase()
      : open || address.toLowerCase() === depositor.toLowerCase()
  )
  const insufficient = balance.data !== undefined && balance.data !== null && balance.data < amount
  const needsApproval = allowance.data !== undefined && allowance.data !== null && allowance.data < amount
  const decimals = display.decimals
  // Until the catalog resolves, avoid putting a derived address-symbol in any
  // button or toast label; the actions are disabled during that window.
  const symbol = metadataReady ? display.symbol : 'token'

  // Canonical venue-aware terms hash from the one shared implementation.
  const termsHash = computeTermsHash(order)
  const termsMismatch = !!leg && leg.termsHash?.toLowerCase() !== termsHash.toLowerCase()
  const winnerKnown = !!order.winner && !isZeroAddress(order.winner)
  const evidence = refundEvidence(order, null, isPayment ? { payment: leg } : { asset: leg })
  if (refundTxHash) {
    if (isPayment) evidence.paymentHash = true
    else evidence.assetHash = true
  }
  const reasonKey = refundReasonKey(displayRefundReason(reason, evidence))
  const refundHash = refundTxHash ?? (leg?.state === 3n ? leg.txHash : undefined)
  const counterpartyLabel = open && isPayment
    ? winnerKnown
      ? truncate(order.winner, 8, 6)
      : 'Open — winner set at settlement'
    : leg
      ? truncate(leg.counterparty, 8, 6)
      : truncate(counterparty, 8, 6)

  const approveArgs = {
    address: venue.token as Address,
    abi: erc20Abi,
    functionName: 'approve' as const,
    args: [escrow as Address, amount] as readonly [Address, bigint],
  }

  function approve() {
    return write(`Approve ${symbol}`, () => writeContractAsync(approveArgs))
  }

  function lock() {
    return write(lockLabel, () => writeContractAsync(lockArgs))
  }

  async function write(label: string, fn: () => Promise<Hex>) {
    setError(null)
    let hash: Hex | undefined
    try {
      hash = await fn()
      txToast(label, hash, chainKey, 'pending')
      await client?.waitForTransactionReceipt({ hash })
      txToast(label, hash, chainKey, 'confirmed')
      refresh()
    } catch (error) {
      setError(txErrorMessage(error, chainKey))
      txToast(label, hash ?? '0x', chainKey, 'error', error)
    }
  }

  const lockArgs = {
    address: escrow as Address,
    abi: isPayment ? paymentEscrowAbi : assetEscrowAbi,
    functionName: 'lock' as const,
    args: (isPayment
      ? [orderId, expectedToken, amount, counterparty, termsHash, order.deadline]
      : [orderId, expectedToken, amount, counterparty, termsHash, order.deadline]) as readonly [Hex, Hex, bigint, Hex, Hex, bigint],
  }

  const locked = !!leg && leg.state > 0n
  const isMatch = open && !isPayment
  const lockLabel = isMatch ? 'Match order' : `Lock ${symbol}`
  const lockDisabled = !canLockByMe || insufficient || !escrow || locked
  const lockTitle = !canLockByMe
    ? isMatch
      ? 'Connect a wallet to match this order'
      : `Only the ${isPayment ? 'buyer' : 'seller'} can lock this leg`
    : insufficient
      ? `Not enough ${symbol} to lock this leg`
      : locked
        ? 'This leg is already locked'
        : undefined

  return (
    <section className="rounded-2xl border border-line bg-paper-0 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <TokenMark
            symbol={symbol}
            kind={isPayment ? 'payment' : 'asset'}
            mark={display.mark}
            color={display.color}
            loading={!metadataReady}
          />
          <div>
            <h3 className="text-sm font-medium text-ink-900">{isPayment ? 'Payment leg' : 'Asset leg'}</h3>
            <p className="mt-0.5 text-[11px] text-ink-400">{display.chainLabel}</p>
          </div>
        </div>
        <span
          aria-live="polite"
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            locked ? 'border-accent/25 bg-accent-soft text-accent-ink' : 'border-line bg-paper-50 text-ink-500'
          }`}
        >
          {stateLabel(leg?.state)}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-md border border-line bg-paper-50 px-2 py-0.5 font-medium text-ink-700">
          {isMatch ? 'Any seller' : isPayment ? 'Buyer' : 'Seller'}
        </span>
        <span className="text-ink-500">
          {canLockByMe
            ? isPayment
              ? `You pay ${symbol}`
              : `You deliver ${symbol}`
            : isPayment
              ? `Buyer pays ${symbol}`
              : isMatch
                ? `Sellers deliver ${symbol}`
                : `Seller delivers ${symbol}`}
        </span>
        {metadataReady && !display.missing && !display.verified && (
          <span className="rounded-full border border-warn/25 bg-warn-soft px-2 py-0.5 text-[10px] text-warn">
            {UNVERIFIED_LABEL}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="tnum font-mono text-[28px] font-medium leading-none text-ink-900">
          {metadataReady ? (
            formatAmount(leg ? leg.amount : amount, decimals, display.symbol)
          ) : (
            <Skeleton className="h-7 w-32" />
          )}
        </div>
        <ChainPill chain={chainKey} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5">
        <div>
          <dt className="text-[11px] text-ink-400">Depositor</dt>
          <dd className="tnum mt-1 font-mono text-xs text-ink-700">
            {leg ? truncate(leg.depositor, 8, 6) : truncate(depositor, 8, 6)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-400">Counterparty</dt>
          <dd className={`mt-1 text-xs ${counterpartyLabel.startsWith('Open') ? 'text-ink-500' : 'tnum font-mono text-ink-700'}`}>
            {counterpartyLabel}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-400">Escrow</dt>
          <dd className="tnum mt-1 font-mono text-xs text-ink-700">
            {escrow ? truncate(escrow, 8, 6) : '—'}
            {escrow && (
              <span className="ml-2">
                <ExternalLink href={addressUrl(chainKey, escrow)} className="text-[11px]">View</ExternalLink>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-400">Your balance</dt>
          <dd className="tnum mt-1 font-mono text-xs text-ink-700">
            {!metadataReady ? (
              <Skeleton className="h-3 w-20" />
            ) : balance.data !== undefined && balance.data !== null ? (
              formatAmount(balance.data, decimals, display.symbol)
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] text-ink-400">Token · {display.chainLabel}</dt>
          <dd className="tnum mt-1 break-all font-mono text-[10px] text-ink-500" title={metadataReady ? (display.address ?? undefined) : undefined}>
            {metadataReady ? (display.address ?? '—') : <Skeleton className="h-3 w-full max-w-[240px]" />}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] text-ink-400">Terms hash (venue-bound)</dt>
          <dd className="tnum mt-1 break-all font-mono text-[10px] text-ink-500" title={termsHash}>{termsHash}</dd>
        </div>
      </dl>

      {termsMismatch && (
        <p className="mt-5 rounded-xl border border-bad/25 bg-bad-soft px-3 py-2 text-xs text-bad">
          Terms on this leg no longer match the order. Do not lock.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-5 rounded-xl border border-bad/25 bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>
      )}

      {!isPayment && reasonKey === 'race_loser' && (
        <Notice className="mt-5" title="Another seller locked first">
          <span>
            You did not win this open order. Your tASSET was returned automatically on {CHAIN_LABELS[chainKey]}.
          </span>
          {winnerKnown && (
            <span>
              {' '}Winner:{' '}
              <ExternalLink href={addressUrl(chainKey, order.winner)} className="text-[11px]">
                {truncate(order.winner, 8, 6)}
              </ExternalLink>.
            </span>
          )}
          {refundHash && <span> Refund: <TxLink chain={chainKey} hash={refundHash} />.</span>}
        </Notice>
      )}

      {reasonKey === 'late' && (
        <Notice className="mt-5" title="Your lock arrived too late">
          <span>
            This order had already been settled or refunded when the lock reached the escrow. The {isPayment ? 'payment' : 'asset'} was returned automatically on {CHAIN_LABELS[chainKey]}.
          </span>
          {refundHash && <span> Refund: <TxLink chain={chainKey} hash={refundHash} />.</span>}
        </Notice>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {needsApproval && !locked ? (
          <WriteButton
            targetChain={chainKey}
            onClick={() => setConfirm('approve')}
            disabled={isPending || !escrow || !canLockByMe || !metadataReady}
            primary
          >
            {isPending ? 'Confirming' : `Approve ${symbol}`}
          </WriteButton>
        ) : (
          <WriteButton
            targetChain={chainKey}
            onClick={() => setConfirm('lock')}
            disabled={lockDisabled || isPending || !metadataReady}
            title={lockTitle}
            primary
          >
            {isPending ? 'Confirming' : locked ? 'Locked' : lockLabel}
          </WriteButton>
        )}
        {lockTitle && <span className="text-[11px] text-ink-500">{lockTitle}</span>}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm === 'approve' ? `Approve ${symbol}?` : `Lock ${symbol}?`}
          description={confirm === 'approve'
            ? 'This allowance lets the escrow spend the exact leg amount.'
            : isMatch ? 'Your lock can win this open order. Funds move on-chain.' : 'This locks the leg into the venue-bound escrow.'}
          details={[
            { label: 'Action', value: confirm === 'approve' ? `Approve ${symbol}` : lockLabel },
            { label: 'Token', value: `${display.name} · ${symbol}${display.verified ? '' : ` · ${UNVERIFIED_LABEL}`}` },
            { label: 'Amount', value: formatAmount(amount, decimals, symbol) },
            { label: 'Chain', value: CHAIN_LABELS[chainKey] },
            { label: 'Escrow', value: truncate(escrow ?? '—', 10, 8) },
            { label: 'Counterparty', value: counterpartyLabel },
            { label: 'Deadline', value: formatDeadline(order.deadline) },
            { label: 'Terms hash', value: truncate(termsHash, 12, 10) },
          ]}
          gasNote={`You will pay gas on ${CHAIN_LABELS[chainKey]}. The backend never signs or holds your keys.`}
          confirmLabel={confirm === 'approve' ? `Approve ${symbol}` : lockLabel}
          busy={isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const action = confirm
            setConfirm(null)
            if (action === 'approve') void approve()
            else void lock()
          }}
        />
      )}
    </section>
  )
}
