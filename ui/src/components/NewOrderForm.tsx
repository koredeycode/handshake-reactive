import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseUnits, type Address, type Hex } from 'viem'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { configuredAddress, useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import { formatAmount, formatDeadline, normalizeAddress, randomOrderId, toUnitString, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { useTokenBalance, useTokenMeta } from '../lib/queries'
import WriteButton from './WriteButton'
import { Button, ChainBadge, Field, Metric, Panel, inputClass, icon } from './ui'

const DURATIONS = [
  { label: '1 minute', value: 60 },
  { label: '2 minutes', value: 120 },
  { label: '1 hour', value: 3600 },
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
    if (!/^0x[a-fA-F0-9]{64}$/.test(orderId)) return 'Order ID must be 32 bytes: 0x followed by 64 hex characters.'
    if (!normalizedSeller) return 'Enter a valid seller address.'
    if (address && normalizedSeller.toLowerCase() === address.toLowerCase()) return 'The seller must differ from the buyer.'
    if (!parsedPayment) return 'Payment amount must be greater than zero.'
    if (!parsedAsset) return 'Asset amount must be greater than zero.'
    if (paymentBalance.data !== undefined && paymentBalance.data !== null && paymentBalance.data < parsedPayment) {
      return `Not enough ${paymentMeta.data?.symbol ?? 'TestUSD'} to cover the payment leg.`
    }
    if (!rc || !paymentToken || !assetToken) return 'The settlement venue is not configured.'
    if (duration < 30) return 'Choose a duration of at least 30 seconds.'
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
    } catch {
      setError('The trade could not be created. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Panel title="Trade terms" subtitle="The connected wallet is the buyer" action={<ChainBadge chain="lasna" />}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <div className="space-y-6">
          <Field label="Order ID" hint="32 bytes">
            <div className="flex gap-2">
              <input className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value.trim())} spellCheck={false} />
              <Button
                size="md"
                icon={<RefreshCw {...icon} />}
                onClick={() => setOrderId(randomOrderId())}
              >
                Generate
              </Button>
            </div>
          </Field>

          <Field label="Seller address" hint="Receives payment on Base">
            <input className={inputClass} placeholder="0x…" value={seller} onChange={(e) => setSeller(e.target.value)} spellCheck={false} />
          </Field>

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Payment amount" hint={`${paymentMeta.data?.symbol ?? 'TestUSD'} · Base Sepolia`}>
              <div className="flex gap-2">
                <input className={inputClass} inputMode="decimal" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
                <Button onClick={() => setPaymentAmount(toUnitString(paymentBalance.data ?? 0n, paymentDecimals))}>Max</Button>
              </div>
            </Field>
            <Field label="Asset amount" hint={`${assetMeta.data?.symbol ?? 'TEST'} · Unichain Sepolia`}>
              <input className={inputClass} inputMode="decimal" value={assetAmount} onChange={(e) => setAssetAmount(e.target.value)} />
            </Field>
          </div>

          <Field label="Settlement window" hint="Deadline is set when the trade is created">
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setDuration(preset.value)}
                  className={`h-9 rounded-lg border px-3 text-[11px] font-medium transition-colors ${
                    duration === preset.value
                      ? 'border-accent/30 bg-accent-soft text-accent'
                      : 'border-line bg-paper-0 text-ink-500 hover:bg-paper-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </Field>

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-bad/25 bg-bad-soft px-3 py-2 text-xs text-bad">
              <AlertCircle {...icon} />
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
            <WriteButton targetChain="lasna" onClick={submit} disabled={!!validation || isPending || submitting} primary>
              {submitting || isPending ? 'Creating trade' : 'Create trade'}
            </WriteButton>
            {validation && <span className="text-[11px] text-ink-500">{validation}</span>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-paper-50 p-5">
            <h3 className="text-sm font-medium text-ink-900">Trade summary</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Deadline" value={formatDeadline(BigInt(deadline))} />
              <Metric label="Window" value={`${duration}s`} />
              <Metric label="Buyer" value={address ? truncate(address, 8, 6) : '—'} />
              <Metric label="Seller" value={normalizedSeller ? truncate(normalizedSeller, 8, 6) : '—'} />
              <Metric label="Payment leg" value={formatAmount(parsedPayment ?? 0n, paymentDecimals, paymentMeta.data?.symbol)} />
              <Metric label="Asset leg" value={formatAmount(parsedAsset ?? 0n, assetDecimals, assetMeta.data?.symbol)} />
            </div>
          </div>
          <div className="rounded-xl border border-line bg-paper-0 p-5">
            <h3 className="text-sm font-medium text-ink-900">Settlement sequence</h3>
            <ol className="mt-4 space-y-3 text-xs text-ink-500">
              <li><span className="tnum mr-3 font-mono text-ink-400">01</span>Buyer locks payment on Base</li>
              <li><span className="tnum mr-3 font-mono text-ink-400">02</span>Seller locks the asset on Unichain</li>
              <li><span className="tnum mr-3 font-mono text-ink-400">03</span>One decision releases both legs</li>
            </ol>
          </div>
        </div>
      </div>
    </Panel>
  )
}
