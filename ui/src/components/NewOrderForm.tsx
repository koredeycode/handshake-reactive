import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseUnits, type Address, type Hex } from 'viem'
import { CHAIN_LABELS } from '../lib/chains'
import { configuredAddress, useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import { formatAmount, formatDeadline, normalizeAddress, randomOrderId, toUnitString, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { useTokenBalance, useTokenMeta } from '../lib/queries'
import { Field, Metric, Panel, inputClass } from './ui'
import { WriteButton } from './OrderDetail'

const DURATIONS = [
  { label: '60s · timeout demo', value: 60 },
  { label: '120s · default', value: 120 },
  { label: '1h', value: 3600 },
]

function parseAmount(value: string, decimals: number): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null
  try {
    const parsed = parseUnits(value.trim(), decimals)
    return parsed > 0n ? parsed : null
  } catch {
    return null
  }
}

export default function NewOrderForm() {
  const navigate = useNavigate()
  const config = useConfig()
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const lasnaClient = logClient(usePublicClient({ chainId: 5318007 })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null

  const [orderId, setOrderId] = useState<string>(() => randomOrderId())
  const [seller, setSeller] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('100')
  const [assetAmount, setAssetAmount] = useState('1')
  const [duration, setDuration] = useState(120)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const paymentMeta = useTokenMeta('payment')
  const assetMeta = useTokenMeta('asset')
  const paymentBalance = useTokenBalance('payment', address)

  const paymentDecimals = paymentMeta.data?.decimals ?? 6
  const assetDecimals = assetMeta.data?.decimals ?? 18
  const parsedPayment = useMemo(() => parseAmount(paymentAmount, paymentDecimals), [paymentAmount, paymentDecimals])
  const parsedAsset = useMemo(() => parseAmount(assetAmount, assetDecimals), [assetAmount, assetDecimals])
  const normalizedSeller = normalizeAddress(seller)
  const deadline = Math.floor(Date.now() / 1000) + duration

  const rc = configuredAddress(config.reactive.reactiveContract)
  const paymentToken = configuredAddress(config.base.paymentToken)
  const assetToken = configuredAddress(config.unichain.assetToken)

  const validation = useMemo(() => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(orderId)) return 'Order ID must be 32 bytes (0x + 64 hex characters).'
    if (!normalizedSeller) return 'Enter a valid seller address.'
    if (address && normalizedSeller.toLowerCase() === address.toLowerCase()) return 'Seller must differ from buyer.'
    if (!parsedPayment) return 'Payment amount must be greater than zero.'
    if (!parsedAsset) return 'Asset amount must be greater than zero.'
    if (paymentBalance.data !== undefined && paymentBalance.data !== null && paymentBalance.data < parsedPayment) {
      return `Insufficient TestUSD: need ${formatAmount(parsedPayment, paymentDecimals)}.`
    }
    if (!rc || !paymentToken || !assetToken) return 'Contract addresses are not configured yet.'
    if (duration < 30) return 'Duration must be at least 30 seconds.'
    return null
  }, [orderId, normalizedSeller, address, parsedPayment, parsedAsset, paymentBalance.data, paymentDecimals, rc, paymentToken, assetToken, duration])

  async function submit() {
    if (validation) {
      setError(validation)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const hash = await writeContractAsync({
        address: rc as Address,
        abi: reactiveAbi,
        functionName: 'createOrder',
        args: [
          orderId as Hex,
          normalizedSeller as Hex,
          paymentToken as Hex,
          parsedPayment!,
          assetToken as Hex,
          parsedAsset!,
          BigInt(duration),
        ],
      })
      await lasnaClient?.waitForTransactionReceipt({ hash })
      navigate(`/orders/${orderId}?tx=${hash}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel
      title="New order"
      subtitle="Creates the order on Lasna. Buyer = connected wallet; both escrow tokens are pinned by deployment."
      action={<span className="rounded-full border border-reactive/30 bg-reactive/10 px-2.5 py-1 font-mono text-[10px] text-reactive">{CHAIN_LABELS.lasna} · 5318007</span>}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <div className="space-y-4">
          <Field label="Order ID" hint="editable for fixed demo IDs">
            <div className="flex gap-2">
              <input className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value.trim())} spellCheck={false} />
              <button type="button" onClick={() => setOrderId(randomOrderId())} className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] text-slate-300 hover:bg-white/[0.08]">
                Randomise
              </button>
            </div>
          </Field>

          <Field label="Seller address" hint="receives payment on Base">
            <input className={inputClass} placeholder="0x…" value={seller} onChange={(e) => setSeller(e.target.value)} spellCheck={false} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment amount" hint={`${paymentMeta.data?.symbol ?? 'TestUSD'} · Base Sepolia`}>
              <div className="flex gap-2">
                <input className={inputClass} inputMode="decimal" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
                <button
                  type="button"
                  onClick={() => setPaymentAmount(toUnitString(paymentBalance.data ?? 0n, paymentDecimals))}
                  className="shrink-0 rounded-lg border border-payment/30 bg-payment/10 px-2.5 text-[11px] font-semibold text-payment hover:bg-payment/20"
                >
                  Max
                </button>
              </div>
            </Field>
            <Field label="Asset amount" hint={`${assetMeta.data?.symbol ?? 'TEST'} · Unichain Sepolia`}>
              <input className={inputClass} inputMode="decimal" value={assetAmount} onChange={(e) => setAssetAmount(e.target.value)} />
            </Field>
          </div>

          <Field label="Duration" hint="deadline = now + duration (unix seconds)">
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setDuration(preset.value)}
                  className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition ${
                    duration === preset.value
                      ? 'border-reactive/50 bg-reactive/15 text-slate-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.07]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </Field>

          {error && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-red-200">{error}</p>}

          <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4">
            <WriteButton targetChain="lasna" onClick={submit} disabled={!!validation || isPending || submitting} primary>
              {submitting || isPending ? 'Creating…' : 'Create order on Lasna'}
            </WriteButton>
            {validation && <span className="text-[11px] text-slate-500">{validation}</span>}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.06] bg-ink-850/50 p-4">
            <h3 className="mb-3 text-xs font-semibold text-slate-200">Preview</h3>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Deadline" value={formatDeadline(BigInt(deadline))} />
              <Metric label="Duration" value={`${duration}s`} />
              <Metric label="Buyer" value={address ? truncate(address, 8, 6) : '—'} hint={address ? 'connected wallet' : 'connect wallet to continue'} />
              <Metric label="Seller" value={normalizedSeller ? truncate(normalizedSeller, 8, 6) : '—'} />
              <Metric label="Payment leg" value={formatAmount(parsedPayment ?? 0n, paymentDecimals, paymentMeta.data?.symbol)} />
              <Metric label="Asset leg" value={formatAmount(parsedAsset ?? 0n, assetDecimals, assetMeta.data?.symbol)} />
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-ink-850/50 p-4 text-[11px] leading-relaxed text-slate-500">
            <p className="mb-2 font-semibold text-slate-300">What happens next</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Buyer approves and locks payment on Base Sepolia.</li>
              <li>Seller locks asset on Unichain Sepolia.</li>
              <li>The reactive contract verifies both legs and requests two callbacks in one transaction.</li>
            </ol>
            <p className="mt-3">No off-chain keeper. Refunds are automatic after the deadline.</p>
          </div>
        </div>
      </div>
    </Panel>
  )
}
