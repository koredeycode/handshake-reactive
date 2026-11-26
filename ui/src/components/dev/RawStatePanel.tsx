import { useState, type FormEvent } from 'react'
import { normalizeOrderId, truncate } from '../../lib/format'
import { useMarket } from '../../lib/markets'
import { useProof } from '../../lib/proofs'
import { useOrder, useVenues } from '../../lib/queries'
import { Button, CopyButton, EmptyState, Metric, Panel, Spinner, TxLink, inputClass, icon } from '../ui'
import type { ChainKey } from '../../lib/chains'
import { Search } from 'lucide-react'

function raw(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), 2)
}

type ProofRole = 'payment' | 'asset' | 'lasna'

const PROOF_FIELDS: Array<{ key: string; label: string; role: ProofRole }> = [
  { key: 'paymentLocked', label: 'PaymentLocked', role: 'payment' },
  { key: 'assetLocked', label: 'AssetLocked', role: 'asset' },
  { key: 'reactive', label: 'Settlement decision', role: 'lasna' },
  { key: 'paymentReleased', label: 'PaymentReleased', role: 'payment' },
  { key: 'assetReleased', label: 'AssetReleased', role: 'asset' },
  { key: 'paymentRefunded', label: 'PaymentRefunded', role: 'payment' },
  { key: 'assetRefunded', label: 'AssetRefunded', role: 'asset' },
]

export default function RawStatePanel() {
  const { chainKeyFor } = useMarket()
  const chainFor = (role: ProofRole): ChainKey => (role === 'lasna' ? 'lasna' : chainKeyFor(role))
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState<string>('')
  const [localError, setLocalError] = useState<string | null>(null)
  const orderId = normalizeOrderId(selected)
  const venues = useVenues()
  const order = useOrder(orderId)
  const proof = useProof(orderId)

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalized = normalizeOrderId(input)
    if (!normalized) {
      setLocalError('Enter an order ID: 64 hex characters, with or without 0x.')
      return
    }
    setLocalError(null)
    setSelected(normalized)
  }

  const proofData = proof.data
  const orderData = order.data

  return (
    <div className="space-y-6">
      <Panel title="Raw on-chain state" subtitle="Unfiltered reads for one order. Every value below comes from an RPC read or a decoded log.">
        <form onSubmit={submit} className="flex flex-wrap gap-3">
          <input
            className={`${inputClass} min-w-[280px] flex-1`}
            placeholder="Paste an order ID for raw proof state"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
          <Button variant="primary" type="submit" icon={<Search {...icon} />}>Read state</Button>
        </form>
        {localError && <p className="mt-3 text-xs text-bad">{localError}</p>}

        {!selected ? (
          <div className="mt-5">
            <EmptyState title="No order selected" message="Paste an order ID to inspect raw proof state. Nothing is seeded." />
          </div>
        ) : order.isLoading || proof.isLoading ? (
          <div className="mt-5 flex items-center justify-center gap-2 py-10 text-xs text-ink-400">
            <Spinner /> Reading state
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Order" value={truncate(selected, 12, 8)} />
              <Metric label="Order found" value={orderData ? 'Yes' : 'No'} />
              <Metric label="Events observed" value={proofData?.events.length ?? 0} />
              <Metric label="Scan to block" value={proofData?.scan.to.toString() ?? '—'} />
            </div>

            <div>
              <h3 className="mb-3 text-xs font-medium text-ink-900">Proof fields · raw debug states</h3>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {PROOF_FIELDS.map((field) => {
                  const event = proofData?.[field.key as keyof typeof proofData]
                  const found = event && typeof event === 'object' && 'txHash' in event ? event : null
                  return (
                    <div key={field.key} className="rounded-xl border border-line bg-paper-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-ink-500">{field.label}</span>
                        <span className={`text-[10px] ${found ? 'text-ink-700' : 'text-ink-400'}`}>
                          {found ? 'Observed' : 'Not observed yet'}
                        </span>
                      </div>
                      <div className="mt-2 font-mono text-[10px]">
                        {found ? <TxLink chain={chainFor(field.role)} hash={found.txHash} /> : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-line bg-paper-50 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-ink-900">Order tuple</h3>
                  <CopyButton text={raw(orderData ?? null)} label="Copy JSON" />
                </div>
                <pre className="max-h-80 overflow-auto font-mono text-[10px] leading-relaxed text-ink-500">
                  {raw(orderData ?? null)}
                </pre>
              </div>
              <div className="rounded-xl border border-line bg-paper-50 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-ink-900">Decoded proof</h3>
                  <CopyButton text={raw(proofData ?? null)} label="Copy JSON" />
                </div>
                <pre className="max-h-80 overflow-auto font-mono text-[10px] leading-relaxed text-ink-500">
                  {raw(proofData ?? null)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Venues" subtitle="Read from the reactive contract, not from a local constant">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {venues.isFetching && <Spinner />}
          <CopyButton text={raw(venues.data ?? null)} label="Copy JSON" />
        </div>
        <pre className="mt-3 max-h-64 overflow-auto font-mono text-[10px] leading-relaxed text-ink-500">
          {venues.data ? raw(venues.data) : 'Not observed yet'}
        </pre>
      </Panel>
    </div>
  )
}
