import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS, CHAIN_LABELS, addressUrl } from '../lib/chains'
import { configuredAddress, useConfig } from '../lib/config'
import { assetEscrowAbi, erc20Abi, paymentEscrowAbi } from '../lib/contracts'
import { computeTermsHash, formatAmount, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { useAllowance, useTokenBalance, type LegKind } from '../lib/queries'
import { useTokenDisplay } from '../lib/tokenDisplay'
import type { ChainKey } from '../lib/chains'
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
  const chainKey: ChainKey = kind === 'payment' ? 'base' : 'unichain'
  const config = useConfig()
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const client = logClient(usePublicClient({ chainId: CHAIN_IDS[chainKey] })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null
  const display = useTokenDisplay(kind)
  const balance = useTokenBalance(kind, address)
  const allowance = useAllowance(kind, address)

  const escrow = configuredAddress(kind === 'payment' ? config.base.paymentEscrow : config.unichain.assetEscrow)
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const isPayment = kind === 'payment'
  const amount = isPayment ? order.paymentAmount : order.assetAmount
  const expectedToken = isPayment ? order.paymentToken : order.assetToken
  const counterparty = isPayment ? order.seller : order.buyer
  const depositor = isPayment ? order.buyer : order.seller
  const canLockByMe = !!address && address.toLowerCase() === depositor.toLowerCase()
  const insufficient = balance.data !== undefined && balance.data !== null && balance.data < amount
  const needsApproval = allowance.data !== undefined && allowance.data !== null && allowance.data < amount
  const decimals = display.decimals
  const symbol = display.symbol

  // Precondition: the terms hash is derived from getOrder(id), never from a quote.
  const termsHash = computeTermsHash(order)
  const termsMismatch = !!leg && leg.termsHash?.toLowerCase() !== termsHash.toLowerCase()

  async function write(label: string, fn: () => Promise<Hex>) {
    try {
      const hash = await fn()
      setNotice({ label, hash, chain: chainKey, status: 'pending' })
      await client?.waitForTransactionReceipt({ hash })
      setNotice({ label, hash, chain: chainKey, status: 'confirmed' })
      refresh()
    } catch {
      setNotice({ label, hash: '0x', chain: chainKey, status: 'error' })
    }
  }

  const lockArgs = {
    address: escrow as Address,
    abi: isPayment ? paymentEscrowAbi : assetEscrowAbi,
    functionName: 'lock' as const,
    args: [orderId, expectedToken, amount, counterparty, termsHash, order.deadline] as const,
  }

  const locked = !!leg && leg.state > 0n
  const lockLabel = `Lock ${symbol}`
  const lockDisabled = !canLockByMe || insufficient || !escrow || !token || locked
  const lockTitle = !canLockByMe
    ? `Only the ${isPayment ? 'buyer' : 'seller'} can lock this leg`
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
            <p className="mt-0.5 text-[11px] text-ink-400">{CHAIN_LABELS[chainKey]}</p>
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
          {isPayment ? 'Buyer' : 'Seller'}
        </span>
        <span className="text-ink-500">
          {canLockByMe
            ? isPayment
              ? `You pay ${symbol}`
              : `You deliver ${symbol}`
            : isPayment
              ? `Buyer pays ${symbol}`
              : `Seller delivers ${symbol}`}
        </span>
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
          <dd className="tnum mt-1 font-mono text-xs text-ink-700">
            {leg ? truncate(leg.counterparty, 8, 6) : truncate(counterparty, 8, 6)}
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
      </dl>

      {termsMismatch && (
        <p className="mt-5 rounded-xl border border-bad/25 bg-bad-soft px-3 py-2 text-xs text-bad">
          Terms on this leg no longer match the order. Do not lock.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {needsApproval && !locked ? (
          <WriteButton
            targetChain={chainKey}
            onClick={() =>
              void write(`Approve ${symbol}`, () =>
                writeContractAsync({
                  address: token as Address,
                  abi: erc20Abi,
                  functionName: 'approve',
                  args: [escrow as Address, amount],
                }),
              )
            }
            disabled={isPending || !token || !escrow || !canLockByMe}
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
                <span className="ml-2">
                  <TxLink chain={notice.chain} hash={notice.hash} />
                </span>
              )}
            </>
          )}
        </p>
      )}
    </section>
  )
}
