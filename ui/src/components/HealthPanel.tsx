import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { CHAIN_IDS, CHAIN_LABELS } from '../lib/chains'
import { configuredAddress, useConfig } from '../lib/config'
import { cron10Event } from '../lib/contracts'
import { formatAmount, formatDeadline, formatNative, truncate } from '../lib/format'
import {
  createTimestampResolver,
  fetchLogs,
  logClient,
  type ProofClients,
} from '../lib/logs'
import { useHealth, type HealthRow } from '../lib/queries'
import { ExternalLink, Metric, Panel, Spinner } from './ui'

function StatusDot({ debt }: { debt?: bigint }) {
  if (debt === undefined) return <span className="h-2 w-2 rounded-full bg-slate-600" />
  return debt === 0n ? (
    <span className="h-2 w-2 rounded-full bg-good shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
  ) : (
    <span className="h-2 w-2 animate-pulse-soft rounded-full bg-bad shadow-[0_0_8px_rgba(248,113,113,0.6)]" />
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
    <div className="rounded-xl border border-white/[0.06] bg-ink-850/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot debt={row?.debt} />
          <h3 className="text-xs font-semibold text-slate-200">{title}</h3>
        </div>
        <span className={`font-mono text-[10px] ${active ? 'text-good' : row?.debt ? 'text-bad' : 'text-slate-500'}`}>
          {active ? 'ACTIVE' : row?.debt ? 'PAUSED · DEBT' : row?.error ?? '—'}
        </span>
      </div>
      {row?.error && <p className="mb-2 text-[10px] text-slate-500">{row.error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Debt" value={row?.debt !== undefined ? `${row.debt.toString()} wei` : '—'} tone={row?.debt ? 'bad' : 'default'} />
        <Metric label="Reserves" value={row?.reserves !== undefined ? formatNative(row.reserves, symbol) : '—'} />
        <Metric label="Balance" value={row?.balance !== undefined ? formatNative(row.balance, symbol) : '—'} />
        <Metric label={tokenLabel} value={row?.tokenBalance !== undefined ? formatAmount(tokenAmount ?? row.tokenBalance, 6) : '—'} />
      </div>
      {row?.target && (
        <p className="mt-3 truncate font-mono text-[10px] text-slate-500">
          target: {truncate(row.target, 10, 8)}
        </p>
      )}
    </div>
  )
}

export default function HealthPanel() {
  const config = useConfig()
  const health = useHealth()
  const lasnaClient = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna }))
  const clients: ProofClients = {
    lasna: lasnaClient,
    base: null,
    unichain: null,
  }
  const legacy = configuredAddress(config.reactive.legacySystemContract)

  const cron = useQuery({
    queryKey: ['cron-status', legacy],
    refetchInterval: 10_000,
    enabled: !!legacy,
    queryFn: async () => {
      if (!legacy) return null
      const latest = await lasnaClient!.getBlockNumber()
      const from = latest > 60n ? latest - 60n : 0n
      const logs = await fetchLogs(lasnaClient!, {
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
      title="System health"
      subtitle="Polls all three chains every 5s. Debt is read from the system contract / callback proxy."
      action={
        <span className="flex items-center gap-2 text-[11px] text-slate-500">
          {health.isFetching && <Spinner />}
          {health.dataUpdatedAt ? `updated ${new Date(health.dataUpdatedAt).toLocaleTimeString()}` : 'loading…'}
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
          row={byKey('base')}
          title="Payment escrow"
          symbol="ETH"
          tokenLabel="Pooled TestUSD"
          tokenAmount={byKey('base')?.tokenBalance}
        />
        <ContractCard
          row={byKey('unichain')}
          title="Asset escrow"
          symbol="ETH"
          tokenLabel="Pooled TEST"
          tokenAmount={byKey('unichain')?.tokenBalance}
        />
        <div className="rounded-xl border border-white/[0.06] bg-ink-850/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-reactive" />
            <h3 className="text-xs font-semibold text-slate-200">Subscriptions &amp; cron</h3>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Active subs" value="—" hint="not stored on-chain" />
            <Metric
              label="Cron10 last seen"
              value={cron.data?.block ? `#${cron.data.block.toString()}` : '—'}
              hint={cron.data?.timestamp ? formatDeadline(BigInt(cron.data.timestamp)) : 'not observed yet'}
            />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            Subscriptions live in the Reactive node, not in contract storage. Verify the 7 criteria with Reactive MCP{' '}
            <code className="text-slate-400">list_subscriptions</code> — the UI will not guess a count.
          </p>
          <div className="mt-3 space-y-1 font-mono text-[10px] text-slate-500">
            <div>Lasna · {CHAIN_LABELS.lasna}</div>
            <ExternalLink href={`https://lasna.reactscan.net/address/${config.reactive.reactiveContract}`}>
              {config.reactive.reactiveContract ? truncate(config.reactive.reactiveContract, 10, 8) : '— RC not configured'}
            </ExternalLink>
          </div>
        </div>
      </div>
    </Panel>
  )
}
