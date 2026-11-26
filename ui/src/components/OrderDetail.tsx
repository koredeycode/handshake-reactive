import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useChainId, useConnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_IDS, CHAIN_LABELS, addressUrl } from '../lib/chains'
import { configuredAddress, useConfig } from '../lib/config'
import { assetEscrowAbi, erc20Abi, paymentEscrowAbi, reactiveAbi } from '../lib/contracts'
import {
  computeTermsHash,
  countdown,
  formatAmount,
  formatDeadline,
  legStateName,
  truncate,
} from '../lib/format'
import { logClient } from '../lib/logs'
import { buildProofMarkdown, useProof } from '../lib/proofs'
import {
  useAllowance,
  useHealth,
  useLeg,
  useOrder,
  useTokenBalance,
  useTokenMeta,
  type LegKind,
} from '../lib/queries'
import { deriveStatus } from '../lib/status'
import type { ChainKey } from '../lib/chains'
import type { Leg, Order } from '../lib/types'
import { useNow } from '../lib/useNow'
import HopTimeline from './HopTimeline'
import { CodeBlock, CopyButton, EmptyState, ExternalLink, Metric, Panel, Spinner, StatusPill, TxLink } from './ui'

interface TxNotice {
  label: string
  hash: Hex
  chain: ChainKey
  status: 'pending' | 'confirmed' | 'error'
  message?: string
}

export function WriteButton({
  targetChain,
  children,
  onClick,
  disabled,
  title,
  primary = false,
}: {
  targetChain: ChainKey
  children: ReactNode
  onClick: () => void | Promise<void>
  disabled?: boolean
  title?: string
  primary?: boolean
}) {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { connectors, connect } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const wrongChain = chainId !== CHAIN_IDS[targetChain]

  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={() => connectors[0] && connect({ connector: connectors[0] })}
        className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.1]"
      >
        Connect wallet
      </button>
    )
  }
  if (wrongChain) {
    return (
      <button
        type="button"
        onClick={() => void switchChainAsync({ chainId: CHAIN_IDS[targetChain] })}
        className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs font-semibold text-warn hover:bg-warn/20"
      >
        Switch to {CHAIN_LABELS[targetChain]}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled}
      title={title}
      className={
        primary
          ? 'rounded-lg bg-gradient-to-r from-reactive to-payment px-3 py-2 text-xs font-bold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
          : 'rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40'
      }
    >
      {children}
    </button>
  )
}

function LegCard({
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
  const meta = useTokenMeta(kind)
  const balance = useTokenBalance(kind, address)
  const allowance = useAllowance(kind, address)
  const health = useHealth()
  const now = useNow()

  const escrow = configuredAddress(kind === 'payment' ? config.base.paymentEscrow : config.unichain.assetEscrow)
  const token = configuredAddress(kind === 'payment' ? config.base.paymentToken : config.unichain.assetToken)
  const isPayment = kind === 'payment'
  const amount = isPayment ? order.paymentAmount : order.assetAmount
  const expectedToken = isPayment ? order.paymentToken : order.assetToken
  const counterparty = isPayment ? order.seller : order.buyer
  const depositor = isPayment ? order.buyer : order.seller
  const canLockByMe = !!address && address.toLowerCase() === depositor.toLowerCase()
  const expired = Number(order.deadline) <= now
  const insufficient = balance.data !== undefined && balance.data !== null && balance.data < amount
  const needsApproval = allowance.data !== undefined && allowance.data !== null && allowance.data < amount
  const chainDebt = (health.data ?? []).find((r) => r.key === chainKey)?.debt
  const debtBlocked = chainDebt !== undefined && chainDebt > 0n
  const termsHash = computeTermsHash(order)
  const termsMismatch = !!leg && leg.termsHash?.toLowerCase() !== termsHash.toLowerCase()

  async function write(label: string, fn: () => Promise<Hex>) {
    try {
      const hash = await fn()
      setNotice({ label, hash, chain: chainKey, status: 'pending' })
      await client?.waitForTransactionReceipt({ hash })
      setNotice({ label, hash, chain: chainKey, status: 'confirmed' })
      refresh()
    } catch (err) {
      setNotice({
        label,
        hash: '0x',
        chain: chainKey,
        status: 'error',
        message: err instanceof Error ? err.message : 'Transaction failed',
      })
    }
  }

  const lockArgs = {
    address: escrow as Address,
    abi: isPayment ? paymentEscrowAbi : assetEscrowAbi,
    functionName: 'lock' as const,
    args: [orderId, expectedToken, amount, counterparty, termsHash, order.deadline] as const,
  }

  const lockDisabled = !canLockByMe || expired || insufficient || !escrow || !token || debtBlocked || !!leg && leg.state > 0n
  const lockTitle = !canLockByMe
    ? `Only ${isPayment ? 'buyer' : 'seller'} can lock this leg`
    : expired
      ? 'order expired — create a new one'
      : insufficient
        ? `insufficient balance — need ${formatAmount(amount, meta.data?.decimals ?? (isPayment ? 6 : 18))}`
        : debtBlocked
          ? 'execution paused — clear debt first'
          : leg && leg.state > 0n
            ? 'leg already locked'
            : undefined

  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-850/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-100">
            {isPayment ? 'Payment leg' : 'Asset leg'} <span className="font-normal text-slate-500">— {CHAIN_LABELS[chainKey]}</span>
          </h3>
          <p className="mt-1 font-mono text-[10px] text-slate-500">
            escrow: {escrow ? truncate(escrow, 10, 8) : '— not configured'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${leg && leg.state > 0n ? 'border-good/30 bg-good/10 text-good' : 'border-white/10 bg-white/[0.03] text-slate-500'}`}>
            {leg ? legStateName(leg.state) : '—'}
          </span>
          {escrow && <ExternalLink href={addressUrl(chainKey, escrow)} className="text-[10px]">view</ExternalLink>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="Locked / required" value={leg ? formatAmount(leg.amount, meta.data?.decimals ?? (isPayment ? 6 : 18)) : '—'} hint={formatAmount(amount, meta.data?.decimals ?? (isPayment ? 6 : 18), meta.data?.symbol)} />
        <Metric label="Leg nonce" value={leg?.nonce?.toString() ?? '—'} />
        <Metric label="Depositor" value={leg ? truncate(leg.depositor, 6, 4) : truncate(depositor, 6, 4)} />
        <Metric label="Counterparty" value={leg ? truncate(leg.counterparty, 6, 4) : truncate(counterparty, 6, 4)} />
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.05] bg-ink-950/50 p-2.5">
        <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
          <span>Expected termsHash (from Lasna getOrder)</span>
          <CopyButton text={termsHash} label="copy" />
        </div>
        <p className="break-all font-mono text-[10px] text-slate-400">{termsHash}</p>
        {termsMismatch && (
          <p className="mt-2 text-[10px] text-bad">⚠ Locked terms differ from the RC order — this leg will be refunded, not settled.</p>
        )}
        {!leg && (
          <p className="mt-2 text-[10px] text-slate-600">
            Pre-flight: confirm this hash with the counterparty before locking. It is derived from the on-chain order, not from a quote.
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {needsApproval ? (
          <WriteButton targetChain={chainKey} onClick={() => void write(`Approve ${meta.data?.symbol ?? 'token'}`, async () => writeContractAsync({
            address: token as Address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [escrow as Address, amount],
          }))} disabled={isPending || !token || !escrow || !canLockByMe || expired} primary>
            {isPending ? 'Confirming…' : `Approve ${meta.data?.symbol ?? 'token'}`}
          </WriteButton>
        ) : (
          <WriteButton targetChain={chainKey} onClick={() => void write(isPayment ? 'Lock payment' : 'Lock asset', () => writeContractAsync(lockArgs))} disabled={lockDisabled || isPending} title={lockTitle} primary>
            {isPending ? 'Confirming…' : isPayment ? 'Lock payment' : 'Lock asset'}
          </WriteButton>
        )}
        {lockTitle && <span className="text-[10px] text-slate-500">{lockTitle}</span>}
        <span className="ml-auto font-mono text-[10px] text-slate-600">
          wallet: {balance.data !== undefined && balance.data !== null ? formatAmount(balance.data, meta.data?.decimals ?? 18, meta.data?.symbol) : '—'}
        </span>
      </div>

      {notice && notice.hash !== '0x' && (
        <p className="mt-2 text-[10px]">
          {notice.status === 'pending' && <span className="text-warn">{notice.label} submitted · </span>}
          {notice.status === 'confirmed' && <span className="text-good">{notice.label} confirmed · </span>}
          <TxLink chain={notice.chain} hash={notice.hash} />
          {notice.message && <span className="text-bad"> · {notice.message}</span>}
        </p>
      )}
    </div>
  )
}

export default function OrderDetail({ orderId }: { orderId: Hex }) {
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
  const health = useHealth()

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
    } catch (err) {
      setNotice({
        label: 'Retry settlement',
        hash: '0x',
        chain: 'lasna',
        status: 'error',
        message: err instanceof Error ? err.message : 'Transaction failed',
      })
    }
  }

  const markdown = buildProofMarkdown(orderId, order, proof)
  const status = order ? deriveStatus(order, now) : null
  const canRetry = !!order && (order.paymentSeen || order.assetSeen) && !(order.paymentClosed && order.assetClosed)
  const debtBlocked = (health.data ?? []).some((row) => row.debt !== undefined && row.debt > 0n)

  if (!config.reactive.reactiveContract) {
    return <Panel><EmptyState title="RC address not configured" message="Fill public/contracts.json after deployment." /></Panel>
  }
  if (isLoading) {
    return <Panel><div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500"><Spinner /> Reading order from Lasna…</div></Panel>
  }
  if (isError || !order) {
    return (
      <Panel>
        <EmptyState
          title="No order found on Lasna for this ID"
          message="Check the ID and try again. Nothing is rendered unless getOrder returns a real order."
          action={<Link to="/orders" className="text-xs text-payment underline">Back to order board</Link>}
        />
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <Panel
        title={`Order ${truncate(orderId, 12, 8)}`}
        subtitle={`Status derived from RC flags · deadline ${formatDeadline(order.deadline)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {status && <StatusPill status={status} />}
            <button type="button" onClick={refresh} className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.08]">Refresh</button>
            <CopyButton text={markdown} label="Copy proof links" />
            <CopyButton text={`${window.location.origin}/verify/${orderId}`} label="Copy verify link" />
            <Link to={`/verify/${orderId}`} className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.08]">Public verify →</Link>
          </div>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Buyer" value={truncate(order.buyer, 8, 6)} hint={addressUrl('base', order.buyer) ? <ExternalLink href={addressUrl('base', order.buyer)} className="text-[10px]">BaseScan</ExternalLink> : undefined} />
          <Metric label="Seller" value={truncate(order.seller, 8, 6)} hint={<ExternalLink href={addressUrl('unichain', order.seller)} className="text-[10px]">Uniscan</ExternalLink>} />
          <Metric label="Payment" value={formatAmount(order.paymentAmount, paymentMeta.data?.decimals ?? 6, paymentMeta.data?.symbol)} hint={`token ${truncate(order.paymentToken, 8, 6)}`} />
          <Metric label="Asset" value={formatAmount(order.assetAmount, assetMeta.data?.decimals ?? 18, assetMeta.data?.symbol)} hint={`token ${truncate(order.assetToken, 8, 6)}`} />
          <Metric label="Deadline" value={countdown(order.deadline, now)} hint={formatDeadline(order.deadline)} tone={Number(order.deadline) <= now ? 'warn' : 'default'} />
          <Metric label="RC nonce" value={order.nonce.toString()} hint="monotonic across all callback batches" />
          <Metric label="Last action" value={formatDeadline(order.lastActionTimestamp)} hint="30s retry cooldown" />
          <Metric label="Flags" value={`pay ${order.paymentSeen ? '✓' : '·'} · asset ${order.assetSeen ? '✓' : '·'} · close ${order.paymentClosed ? '✓' : '·'}/${order.assetClosed ? '✓' : '·'}`} />
        </div>

        {notice && notice.hash !== '0x' && (
          <div className="mt-4 rounded-lg border border-white/[0.07] bg-ink-950/60 p-3 text-[11px]">
            <span className={notice.status === 'error' ? 'text-bad' : notice.status === 'confirmed' ? 'text-good' : 'text-warn'}>
              {notice.label} · {notice.status}
            </span>
            {' · '}<TxLink chain={notice.chain} hash={notice.hash} />
            {notice.message && <span className="text-bad"> · {notice.message}</span>}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
          {canRetry && (
            <WriteButton targetChain="lasna" onClick={retry} disabled={isPending || debtBlocked} title={debtBlocked ? 'execution paused — clear debt first' : 'permissionless; bumps nonce and re-issues callbacks for open legs'}>
              {isPending ? 'Submitting…' : 'Retry settlement'}
            </WriteButton>
          )}
          {canRetry && <span className="text-[10px] text-slate-500">a leg is locked but not closed</span>}
          {debtBlocked && <span className="text-[10px] text-bad">execution paused — clear debt before writes</span>}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]">
        <div className="space-y-4">
          <LegCard kind="payment" order={order} leg={paymentLeg.data} orderId={orderId} notice={notice} setNotice={setNotice} refresh={refresh} />
          <LegCard kind="asset" order={order} leg={assetLeg.data} orderId={orderId} notice={notice} setNotice={setNotice} refresh={refresh} />
          <Panel title="Proof markdown" subtitle="Submission-ready table copied by the button above">
            <CodeBlock>{markdown}</CodeBlock>
          </Panel>
          <Panel title="Event log" subtitle="Decoded logs from all three chains for this order" action={<Link to={`/events?order=${orderId}`} className="text-[11px] text-payment underline">Open full log →</Link>}>
            <p className="text-xs text-slate-500">
              Use the public event log to inspect PaymentLocked, AssetLocked, CallbackRequest and terminal events.
            </p>
          </Panel>
        </div>
        <HopTimeline order={order} proof={proof} orderId={orderId} />
      </div>
    </div>
  )
}
