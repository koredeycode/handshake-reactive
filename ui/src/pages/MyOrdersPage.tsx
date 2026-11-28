import { ArrowRight, Plus, RefreshCw, Wallet } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount, useConnect } from 'wagmi'
import type { Address } from 'viem'
import {
  Button,
  ChainMark,
  EmptyState,
  Panel,
  Skeleton,
  Spinner,
  StatusPill,
  TokenMark,
  TxLink,
  icon,
} from '../components/ui'
import { countdown, formatAmount, formatDeadline, formatTimestamp, isZeroAddress, truncate } from '../lib/format'
import { buildHops, orderChainKeys, useProof } from '../lib/proofs'
import { useAllOrders, type AggregatedOrderRow } from '../lib/queries'
import { useOrderStatus } from '../lib/status'
import { useOrderTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'

const MAX_ROWS = 8

interface WalletOrderProps {
  row: AggregatedOrderRow
  wallet: Address
  now: number
}

function WalletOrderRow({ row, wallet, now }: WalletOrderProps) {
  const { id, order } = row
  const payment = useOrderTokenDisplay(order, 'payment')
  const asset = useOrderTokenDisplay(order, 'asset')
  const metadataReady = payment.metadataReady && asset.metadataReady
  const address = wallet.toLowerCase()
  const isBuyer = order.buyer.toLowerCase() === address
  const isSeller =
    order.seller.toLowerCase() === address ||
    (!isZeroAddress(order.winner) && order.winner.toLowerCase() === address)
  const status = useOrderStatus(order)
  const proof = useProof(id, order)
  const expired = countdown(order.deadline, now) === 'expired'
  const chainKeys = orderChainKeys(order)

  const hashes = buildHops(order, proof.data, chainKeys)
    .filter((hop) => {
      if (hop.key === 'reactive') return true
      if (hop.key.startsWith('payment')) return isBuyer
      if (hop.key.startsWith('asset')) return isSeller
      return false
    })
    .filter((hop) => !!hop.event?.txHash)

  return (
    <li className="px-6 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {isBuyer && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-100 px-2.5 py-1 text-[11px] font-medium text-ink-700">
                <ChainMark chain={payment.chain} /> You pay
              </span>
            )}
            {isSeller && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-100 px-2.5 py-1 text-[11px] font-medium text-ink-700">
                <ChainMark chain={asset.chain} /> You deliver
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <TokenMark symbol={payment.symbol} kind="payment" size="sm" mark={payment.mark} color={payment.color} loading={!metadataReady} />
              <span className="tnum font-mono text-[13px] font-medium text-ink-900">
                {metadataReady ? formatAmount(order.paymentAmount, payment.decimals, payment.symbol) : <Skeleton className="h-4 w-20" />}
              </span>
            </span>
            <ArrowRight {...icon} className="text-ink-400" />
            <span className="flex items-center gap-2">
              <TokenMark symbol={asset.symbol} kind="asset" size="sm" mark={asset.mark} color={asset.color} loading={!metadataReady} />
              <span className="tnum font-mono text-[13px] font-medium text-ink-900">
                {metadataReady ? formatAmount(order.assetAmount, asset.decimals, asset.symbol) : <Skeleton className="h-4 w-20" />}
              </span>
            </span>
          </div>
        </div>
        <StatusPill status={status!} reason={order.refundReason} order={order} proof={proof.data} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-400">
        <span className={`tnum font-mono ${expired ? 'text-warn' : 'text-ink-400'}`} title={formatDeadline(order.deadline)}>
          {countdown(order.deadline, now)}
        </span>
        <span className="tnum font-mono">{truncate(id, 12, 8)}</span>
        {hashes.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {hashes.map((hop) => (
              <span key={hop.event!.id} className="inline-flex items-center gap-1">
                <ChainMark chain={hop.chain} className="h-3 w-3" />
                <TxLink chain={hop.chain} hash={hop.event!.txHash} label={truncate(hop.event!.txHash, 6, 4)} />
              </span>
            ))}
          </span>
        )}
        <Link to={`/orders/${id}`} className="ml-auto inline-flex items-center gap-1 font-medium text-ink-700 transition-colors hover:text-accent">
          Order detail <ArrowRight {...icon} />
        </Link>
      </div>

      <details className="mt-2">
        <summary className="w-fit cursor-pointer text-[10px] text-ink-400">Advanced</summary>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-400">
          <span className="tnum font-mono">Nonce {order.nonce.toString()}</span>
          <span className="tnum font-mono">Last action {formatTimestamp(order.lastActionTimestamp)}</span>
        </div>
      </details>
    </li>
  )
}

export default function MyOrdersPage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { data: orders, isLoading, isError, refetch, isFetching } = useAllOrders()
  const now = useNow()

  const mine = address
    ? (orders ?? []).filter(
        ({ order }) =>
          order.buyer.toLowerCase() === address.toLowerCase() ||
          order.seller.toLowerCase() === address.toLowerCase() ||
          (!isZeroAddress(order.winner) && order.winner.toLowerCase() === address.toLowerCase()),
      )
    : []

  const body = !isConnected || !address ? (
    <div className="p-6">
      <EmptyState
        title="Connect to see your orders"
        message="Orders where your wallet pays or delivers will appear here."
        action={
          <Button variant="primary" icon={<Wallet {...icon} />} disabled={!connectors[0] || isPending} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            {isPending ? 'Connecting' : 'Connect wallet'}
          </Button>
        }
      />
    </div>
  ) : isError ? (
    <div className="p-6">
      <EmptyState title="Orders unavailable" message="Your order history could not be loaded right now." action={<Button onClick={() => void refetch()}>Try again</Button>} />
    </div>
  ) : isLoading ? (
    <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500"><Spinner /> Loading orders</div>
  ) : mine.length === 0 ? (
    <div className="p-6">
      <EmptyState title="No orders from this wallet" message="Trades you create or fulfill will appear here." action={<Button icon={<Plus {...icon} />} onClick={() => navigate('/new')}>New trade</Button>} />
    </div>
  ) : (
    <ul className="divide-y divide-line">
      {mine.slice(0, MAX_ROWS).map((row) => <WalletOrderRow key={row.id} row={row} wallet={address} now={now} />)}
    </ul>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-ink-900">My orders</h1>
        <p className="mt-1 text-xs text-ink-500">Every trade where your wallet is the buyer or the seller</p>
      </div>
      <Panel
        title="Your order history"
        subtitle="Newest first · only your trades"
        action={isConnected && address ? (
          <div className="flex items-center gap-2">
            {isFetching && <Spinner />}
            <span className="tnum font-mono text-[11px] text-ink-400">{mine.length} orders</span>
            <Button size="sm" icon={<RefreshCw {...icon} />} onClick={() => void refetch()}>Refresh</Button>
          </div>
        ) : undefined}
      >
        {body}
      </Panel>
      {mine.length > MAX_ROWS && <p className="text-[11px] text-ink-400">Showing your {MAX_ROWS} most recent orders.</p>}
    </div>
  )
}
