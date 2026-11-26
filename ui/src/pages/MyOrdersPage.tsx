import { ArrowRight, Plus, RefreshCw, Wallet } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount, useConnect } from 'wagmi'
import type { Address } from 'viem'
import {
  Button,
  ChainMark,
  EmptyState,
  Panel,
  Spinner,
  StatusPill,
  TokenMark,
  TxLink,
  icon,
} from '../components/ui'
import { countdown, formatAmount, formatDeadline, isZeroAddress, truncate } from '../lib/format'
import { chainKeyFromId } from '../lib/markets'
import { buildHops, useProof } from '../lib/proofs'
import { useAllOrders, type AggregatedOrderRow } from '../lib/queries'
import { deriveStatus } from '../lib/status'
import { useMarketTokenDisplay } from '../lib/tokenDisplay'
import { useNow } from '../lib/useNow'

const MAX_ROWS = 8

interface WalletOrderProps {
  row: AggregatedOrderRow
  wallet: Address
  now: number
}

/** One wallet order, with only the observed hashes relevant to the user's side. */
function WalletOrderRow({ row, wallet, now }: WalletOrderProps) {
  const { id, order, market } = row
  const payment = useMarketTokenDisplay(market, 'payment')
  const asset = useMarketTokenDisplay(market, 'asset')
  const paymentChain = chainKeyFromId(market.payment.chainId, market.payment.chainKey)
  const assetChain = chainKeyFromId(market.asset.chainId, market.asset.chainKey)
  const address = wallet.toLowerCase()
  const isBuyer = order.buyer.toLowerCase() === address
  const isSeller =
    order.seller.toLowerCase() === address ||
    (!isZeroAddress(order.winner) && order.winner.toLowerCase() === address)
  const status = deriveStatus(order, now)
  // Proof queries are shared by queryKey with the detail/verify screens. The
  // hook only polls while the order is non-terminal; settled/refunded rows
  // fetch once and are then cached indefinitely (no per-row 5s log scans).
  const proof = useProof(id, order, market)
  const expired = countdown(order.deadline, now) === 'expired'

  const hashes = buildHops(order, proof.data, { payment: paymentChain, asset: assetChain })
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
                <ChainMark chain={paymentChain} /> You pay
              </span>
            )}
            {isSeller && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-100 px-2.5 py-1 text-[11px] font-medium text-ink-700">
                <ChainMark chain={assetChain} /> You deliver
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2">
              <TokenMark symbol={payment.symbol} kind="payment" size="sm" mark={payment.mark} color={payment.color} />
              <span className="tnum font-mono text-[13px] font-medium text-ink-900">
                {formatAmount(order.paymentAmount, payment.decimals, payment.symbol)}
              </span>
            </span>
            <ArrowRight {...icon} className="text-ink-400" />
            <span className="flex items-center gap-2">
              <TokenMark symbol={asset.symbol} kind="asset" size="sm" mark={asset.mark} color={asset.color} />
              <span className="tnum font-mono text-[13px] font-medium text-ink-900">
                {formatAmount(order.assetAmount, asset.decimals, asset.symbol)}
              </span>
            </span>
          </div>
        </div>
        <StatusPill status={status} />
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
        <Link
          to={`/orders/${id}?market=${market.id}`}
          className="ml-auto inline-flex items-center gap-1 font-medium text-ink-700 transition-colors hover:text-accent"
        >
          Order detail <ArrowRight {...icon} />
        </Link>
      </div>
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
          <Button
            variant="primary"
            icon={<Wallet {...icon} />}
            disabled={!connectors[0] || isPending}
            onClick={() => connectors[0] && connect({ connector: connectors[0] })}
          >
            {isPending ? 'Connecting' : 'Connect wallet'}
          </Button>
        }
      />
    </div>
  ) : isError ? (
    <div className="p-6">
      <EmptyState
        title="Orders unavailable"
        message="Your order history could not be loaded right now."
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    </div>
  ) : isLoading ? (
    <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-500">
      <Spinner /> Loading orders
    </div>
  ) : mine.length === 0 ? (
    <div className="p-6">
      <EmptyState
        title="No orders from this wallet"
        message="Trades you create or fulfill will appear here."
        action={
          <Button icon={<Plus {...icon} />} onClick={() => navigate('/new')}>
            New trade
          </Button>
        }
      />
    </div>
  ) : (
    <ul className="divide-y divide-line">
      {mine.slice(0, MAX_ROWS).map((row) => (
        <WalletOrderRow key={row.id} row={row} wallet={address} now={now} />
      ))}
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
        action={
          isConnected && address ? (
            <div className="flex items-center gap-2">
              {isFetching && <Spinner />}
              <span className="tnum font-mono text-[11px] text-ink-400">{mine.length} orders</span>
              <Button size="sm" icon={<RefreshCw {...icon} />} onClick={() => void refetch()}>
                Refresh
              </Button>
            </div>
          ) : undefined
        }
        bodyClass=""
      >
        {body}
      </Panel>
      {mine.length > MAX_ROWS && (
        <p className="text-[11px] text-ink-400">Showing your {MAX_ROWS} most recent orders.</p>
      )}
    </div>
  )
}
