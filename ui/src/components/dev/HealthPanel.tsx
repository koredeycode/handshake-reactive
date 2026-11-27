import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { CHAIN_IDS, CHAIN_LABELS } from '../../lib/chains'
import { configuredAddress } from '../../lib/config'
import { cron10Event } from '../../lib/contracts'
import { formatAmount, formatDeadline, formatNative, truncate } from '../../lib/format'
import {
  createTimestampResolver,
  fetchLogs,
  logClient,
  type ProofClients,
} from '../../lib/logs'
import { useMarket, useMarketConfig } from '../../lib/markets'
import { useHealth, type HealthRow } from '../../lib/queries'
import { useSubscriptionCount } from '../../lib/venues'
import { ExternalLink, Metric, Panel, Spinner } from '../ui'

function StatusDot({ debt }: { debt?: bigint }) {
  if (debt === undefined) return <span className="h-2 w-2 rounded-full bg-ink-400" />
  return debt === 0n ? (
    <span className="h-2 w-2 rounded-full bg-ink-900" />
  ) : (
    <span className="h-2 w-2 rounded-full bg-bad" />
  )
}

function ContractCard({
  row,
  title,
  symbol,
  tokenLabel,
  tokenAmount,
}: {
  row?: HealthRow
  title: string
  symbol: string
  tokenLabel: string
  tokenAmount?: bigint
}) {
  const active = row?.debt === 0n
  return (
    <div className="rounded-xl border border-line bg-paper-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot debt={row?.debt} />
          <h3 className="text-xs font-medium text-ink-900">{title}</h3>
        </div>
        <span
          className={`font-mono text-[10px] ${
            active ? 'text-ink-700' : row?.debt ? 'text-bad' : 'text-ink-400'
          }`}
        >
          {active ? 'Active' : row?.debt ? 'Paused · debt' : (row?.error ?? 'Not read yet')}
        </span>
      </div>
      {row?.error && <p className="mb-2 text-[10px] text-ink-400">{row.error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Debt" value={row?.debt !== undefined ? `${row.debt.toString()} wei` : '—'} tone={row?.debt ? 'bad' : 'default'} />
        <Metric label="Reserves" value={row?.reserves !== undefined ? formatNative(row.reserves, symbol) : '—'} />
        <Metric label="Balance" value={row?.balance !== undefined ? formatNative(row.balance, symbol) : '—'} />
        <Metric label={tokenLabel} value={row?.tokenBalance !== undefined ? formatAmount(tokenAmount ?? row.tokenBalance, 6) : '—'} />
      </div>
      {row?.target && (
        <p className="mt-3 truncate font-mono text-[10px] text-ink-400">target: {truncate(row.target, 10, 8)}</p>
      )}
    </div>
  )
}

export default function HealthPanel() {
  const config = useMarketConfig()
  const { market, chainKeyFor } = useMarket()
  const health = useHealth()
  const lasnaClient = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const clients: ProofClients = { lasna: lasnaClient, payment: null, asset: null }
  const legacy = configuredAddress(config.reactive.legacySystemContract)
  const paymentChain = chainKeyFor('payment')
  const assetChain = chainKeyFor('asset')

  const subscriptions = useSubscriptionCount()

  const cron = useQuery({
    queryKey: ['cron-status', market.id, legacy],
    staleTime: 20_000,
    refetchInterval: 30_000, // dev-only; was 10s
    enabled: !!legacy,
    queryFn: async () => {
      if (!legacy || !lasnaClient) return null
      const latest = await lasnaClient.getBlockNumber()
      const from = latest > 60n ? latest - 60n : 0n
      const logs = await fetchLogs(lasnaClient, {
        address: legacy,
        event: cron10Event,
        fromBlock: from,
        toBlock: latest,
        maxChunks: 1,
      })
      if (!logs.length) return null
      const last = logs[logs.length - 1]
      const timestamp = await createTimestampResolver(clients)('lasna', last.blockNumber)
      return { block: last.blockNumber, timestamp }
    },
  })

  const rows = health.data ?? []
  const byKey = (key: HealthRow['key']) => rows.find((r) => r.key === key)

  return (
    <Panel
      title="Debt, reserves and health"
      subtitle={`Polls ${CHAIN_LABELS.lasna}, ${CHAIN_LABELS[paymentChain]} and ${CHAIN_LABELS[assetChain]} every 15s (dev-only). Debt is read from the system contract / callback proxy.`}
      action={
        <span className="flex items-center gap-2 text-[11px] text-ink-400">
          {health.isFetching && <Spinner />}
          {health.dataUpdatedAt ? `Updated ${new Date(health.dataUpdatedAt).toLocaleTimeString()}` : 'Not read yet'}
        </span>
      }
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ContractCard
          row={byKey('lasna')}
          title="Reactive arbiter"
          symbol="lREACT"
          tokenLabel="RC balance"
          tokenAmount={byKey('lasna')?.balance}
        />
        <ContractCard
          row={byKey('payment')}
          title={`Payment escrow · ${CHAIN_LABELS[paymentChain]}`}
          symbol="ETH"
          tokenLabel="Pooled payment token"
          tokenAmount={byKey('payment')?.tokenBalance}
        />
        <ContractCard
          row={byKey('asset')}
          title={`Asset escrow · ${CHAIN_LABELS[assetChain]}`}
          symbol="ETH"
          tokenLabel="Pooled asset token"
          tokenAmount={byKey('asset')?.tokenBalance}
        />
        <div className="rounded-xl border border-line bg-paper-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-ink-400" />
            <h3 className="text-xs font-medium text-ink-900">Subscriptions and cron</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Active subs"
              value={subscriptions.data !== null && subscriptions.data !== undefined ? subscriptions.data : '—'}
              hint="subscriptionCount() on the RC"
            />
            <Metric
              label="Cron10 last seen"
              value={cron.data?.block ? `#${cron.data.block.toString()}` : '—'}
              hint={cron.data?.timestamp ? formatDeadline(BigInt(cron.data.timestamp)) : 'Not observed yet'}
            />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-ink-400">
            Six subscriptions per registered venue plus Cron10. The count is read from the RC registry,
            not guessed; log-based confirmation lives in the preflight script.
          </p>
          <div className="mt-3 space-y-1 font-mono text-[10px] text-ink-400">
            <div>{CHAIN_LABELS.lasna}</div>
            <ExternalLink href={`https://lasna.reactscan.net/address/${config.reactive.reactiveContract}`}>
              {config.reactive.reactiveContract ? truncate(config.reactive.reactiveContract, 10, 8) : '— RC not configured'}
            </ExternalLink>
          </div>
        </div>
      </div>
    </Panel>
  )
}
