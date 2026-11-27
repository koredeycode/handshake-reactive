import { useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS, addressUrl } from '../lib/chains'
import { assetEscrowAbi, erc20Abi, paymentEscrowAbi } from '../lib/contracts'
import { formatAmount, isZeroAddress, truncate, ZERO_ADDRESS } from '../lib/format'
import { logClient } from '../lib/logs'
import { useAllowance, useErc20Balance, type LegKind } from '../lib/queries'
import { isOpenOrder } from '../lib/status'
import { computeTermsHash } from '../lib/terms'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { UNVERIFIED_LABEL } from '../lib/tradeTicket'
import { venueOfOrder } from '../lib/venue'
import type { Leg, Order } from '../lib/types'
import WriteButton, { type TxNotice } from './WriteButton'
import { ChainPill, ExternalLink, TokenMark, TxLink } from './ui'

function stateLabel(state?: bigint | null): string {
  if (state === undefined || state === null) return 'Not locked'
  return ['Not locked', 'Locked', 'Released', 'Refunded'][Number(state)] ?? 'Locked'
}

export default function LegCard({
  kind,
  order,
  leg,
  orderId,
  notice,
  setNotice,
  refresh,
}: {
  kind: LegKind
  order: Order
  leg?: Leg | null
  orderId: Hex
  notice: TxNotice | null
  setNotice: (n: TxNotice | null) => void
  refresh: () => void
}) {
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const [error, setError] = useState<string | null>(null)

  // Every chain, escrow, token and decimal comes from THIS order's venue.
  const venue = venueOfOrder(order, kind)
  const chainKey = venue.chainKey
  const escrow = venue.escrow
  const display = useOrderTokenDisplay(order, kind)
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
  const symbol = display.symbol

  // Canonical venue-aware terms hash from the one shared implementation.
  const termsHash = computeTermsHash(order)
  const termsMismatch = !!leg && leg.termsHash?.toLowerCase() !== termsHash.toLowerCase()
  const winnerKnown = !!order.winner && !isZeroAddress(order.winner)
  const counterpartyLabel = open && isPayment
    ? winnerKnown
      ? truncate(order.winner, 8, 6)
      : 'Open — winner set at settlement'
    : leg
      ? truncate(leg.counterparty, 8, 6)
      : truncate(counterparty, 8, 6)

  async function write(label: string, fn: () => Promise<Hex>) {
    setError(null)
    try {
      const hash = await fn()
      setNotice({ label, hash, chain: chainKey, status: 'pending' })
      await client?.waitForTransactionReceipt({ hash })
      setNotice({ label, hash, chain: chainKey, status: 'confirmed' })
      refresh()
    } catch {
      setError('The transaction did not complete. Check the connected chain and token approval.')
      setNotice({ label, hash: '0x', chain: chainKey, status: 'error' })
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
          />
          <div>
            <h3 className="text-sm font-medium text-ink-900">{isPayment ? 'Payment leg' : 'Asset leg'}</h3>
            <p className="mt-0.5 text-[11px] text-ink-400">{display.chainLabel}</p>
          </div>
        </div>
        <span
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
        {!display.verified && (
          <span className="rounded-full border border-warn/25 bg-warn-soft px-2 py-0.5 text-[10px] text-warn">
            {UNVERIFIED_LABEL}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="tnum font-mono text-[28px] font-medium leading-none text-ink-900">
          {formatAmount(leg ? leg.amount : amount, decimals, symbol)}
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
            {balance.data !== undefined && balance.data !== null ? formatAmount(balance.data, decimals, symbol) : '—'}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] text-ink-400">Token · {display.chainLabel}</dt>
          <dd className="tnum mt-1 break-all font-mono text-[10px] text-ink-500" title={display.address ?? undefined}>
            {display.address ?? '—'}
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
        <p className="mt-5 rounded-xl border border-bad/25 bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {needsApproval && !locked ? (
          <WriteButton
            targetChain={chainKey}
            onClick={() =>
              void write(`Approve ${symbol}`, () =>
                writeContractAsync({
                  address: venue.token as Address,
                  abi: erc20Abi,
                  functionName: 'approve',
                  args: [escrow as Address, amount],
                }),
              )
            }
            disabled={isPending || !escrow || !canLockByMe}
            primary
          >
            {isPending ? 'Confirming' : `Approve ${symbol}`}
          </WriteButton>
        ) : (
          <WriteButton
            targetChain={chainKey}
            onClick={() => void write(lockLabel, () => writeContractAsync(lockArgs))}
            disabled={lockDisabled || isPending}
            title={lockTitle}
            primary
          >
            {isPending ? 'Confirming' : locked ? 'Locked' : lockLabel}
          </WriteButton>
        )}
        {lockTitle && <span className="text-[11px] text-ink-500">{lockTitle}</span>}
      </div>

      {notice && notice.chain === chainKey && (
        <p className="mt-4 text-[11px]">
          {notice.status === 'error' ? (
            <span className="text-bad">The transaction did not complete. Try again.</span>
          ) : (
            <>
              <span className={notice.status === 'confirmed' ? 'text-good' : 'text-ink-500'}>
                {notice.label} {notice.status === 'confirmed' ? 'confirmed' : 'submitted'}
              </span>
              {notice.hash !== '0x' && (
                <span className="ml-2"><TxLink chain={notice.chain} hash={notice.hash} /></span>
              )}
            </>
          )}
        </p>
      )}
    </section>
  )
}
