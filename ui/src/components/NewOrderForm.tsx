import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseUnits, type Address, type Hex } from 'viem'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { configuredAddress, useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import { formatAmount, formatDeadline, normalizeAddress, randomOrderId, toUnitString, truncate } from '../lib/format'
import { logClient } from '../lib/logs'
import { useTokenBalance } from '../lib/queries'
import { useTokenDisplay } from '../lib/tokenDisplay'
import WriteButton from './WriteButton'
import TradeTicket from './TradeTicket'
import { Button, ConvergenceMark, Field, Metric, Panel, inputClass, icon } from './ui'

/** Mirror of the contract's MIN_DURATION / MAX_DURATION (HandshakeReactive.sol). */
const MIN_DURATION = 30
const MAX_DURATION = 30 * 24 * 60 * 60

const DURATIONS = [
  { label: '1 minute', value: 60 },
  { label: '2 minutes', value: 120 },
  { label: '1 hour', value: 3600 },
]

const UNITS = [
  { label: 'seconds', seconds: 1 },
  { label: 'minutes', seconds: 60 },
  { label: 'hours', seconds: 60 * 60 },
  { label: 'days', seconds: 24 * 60 * 60 },
] as const

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
  const [params] = useSearchParams()
  const config = useConfig()
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const lasnaClient = logClient(usePublicClient({ chainId: 5318007 })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null

  const [orderId, setOrderId] = useState<string>(() => randomOrderId())
  const [seller, setSeller] = useState('')
  const [paymentAmount, setPaymentAmount] = useState(params.get('pay') ?? '100')
  const [assetAmount, setAssetAmount] = useState(params.get('get') ?? '1')
  const [customValue, setCustomValue] = useState('120')
  const [unit, setUnit] = useState<(typeof UNITS)[number]['seconds']>(1)
  const [preset, setPreset] = useState<number | null>(120)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const paymentToken = useTokenDisplay('payment')
  const assetToken = useTokenDisplay('asset')
  const paymentBalance = useTokenBalance('payment', address)

  const paymentDecimals = paymentToken.decimals
  const assetDecimals = assetToken.decimals
  const parsedPayment = useMemo(() => parseAmount(paymentAmount, paymentDecimals), [paymentAmount, paymentDecimals])
  const parsedAsset = useMemo(() => parseAmount(assetAmount, assetDecimals), [assetAmount, assetDecimals])
  const normalizedSeller = normalizeAddress(seller)
  const entered = customValue.trim() === '' ? NaN : Number(customValue)
  const duration = Number.isFinite(entered) ? entered * unit : NaN
  const validDuration = Number.isSafeInteger(duration) ? duration : null
  const durationError =
    validDuration === null
      ? 'Enter a whole number for the settlement window.'
      : validDuration < MIN_DURATION
        ? 'The window must be at least 30 seconds.'
        : validDuration > MAX_DURATION
          ? 'The window cannot be longer than 30 days.'
          : null
  const deadline = validDuration !== null ? Math.floor(Date.now() / 1000) + validDuration : null

  const rc = configuredAddress(config.reactive.reactiveContract)
  const paymentTokenAddress = configuredAddress(config.base.paymentToken)
  const assetTokenAddress = configuredAddress(config.unichain.assetToken)

  const validation = useMemo(() => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(orderId)) return 'Order ID must be 32 bytes: 0x followed by 64 hex characters.'
    if (!normalizedSeller) return 'Enter a valid seller address.'
    if (address && normalizedSeller.toLowerCase() === address.toLowerCase()) return 'The seller must differ from the buyer.'
    if (!parsedPayment) return 'Payment amount must be greater than zero.'
    if (!parsedAsset) return 'Asset amount must be greater than zero.'
    if (paymentBalance.data !== undefined && paymentBalance.data !== null && paymentBalance.data < parsedPayment) {
      return `Not enough ${paymentToken.symbol} to cover the payment leg.`
    }
    if (!rc || !paymentTokenAddress || !assetTokenAddress) return 'The settlement venue is not configured.'
    if (durationError) return durationError
    return null
  }, [
    orderId,
    normalizedSeller,
    address,
    parsedPayment,
    parsedAsset,
    paymentBalance.data,
    paymentToken.symbol,
    rc,
    paymentTokenAddress,
    assetTokenAddress,
    durationError,
  ])

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
          paymentTokenAddress as Hex,
          parsedPayment!,
          assetTokenAddress as Hex,
          parsedAsset!,
          BigInt(validDuration!),
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
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
      <div className="space-y-6">
        <Panel title="Trade ticket" subtitle="The connected wallet is the buyer" bodyClass="p-4 sm:p-5">
          <TradeTicket
            pay={{
              symbol: paymentToken.symbol,
              chain: 'base',
              amount: paymentAmount,
              onAmountChange: setPaymentAmount,
              kind: 'payment',
              mark: paymentToken.mark,
              color: paymentToken.color,
              hint:
                paymentBalance.data !== undefined && paymentBalance.data !== null
                  ? `${paymentToken.name} · balance ${toUnitString(paymentBalance.data, paymentDecimals)} ${paymentToken.symbol}`
                  : `${paymentToken.name} · Base Sepolia testnet`,
            }}
            receive={{
              symbol: assetToken.symbol,
              chain: 'unichain',
              amount: assetAmount,
              onAmountChange: setAssetAmount,
              kind: 'asset',
              mark: assetToken.mark,
              color: assetToken.color,
              hint: `${assetToken.name} · Unichain Sepolia testnet`,
            }}
          />

          <div className="mt-5 space-y-5 px-1">
            <Field label="Seller address" hint="Receives payment on Base">
              <input
                className={inputClass}
                placeholder="0x…"
                value={seller}
                onChange={(e) => setSeller(e.target.value)}
                spellCheck={false}
              />
            </Field>

            <Field label="Settlement window" hint="30 seconds – 30 days">
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setPreset(option.value)
                      setCustomValue(String(option.value))
                      setUnit(1)
                    }}
                    className={`h-9 rounded-xl border px-3 text-[11px] font-medium transition-colors ${
                      preset === option.value
                        ? 'border-accent/25 bg-accent-soft text-accent-ink'
                        : 'border-line bg-paper-0 text-ink-500 hover:bg-paper-100'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  aria-label="Custom settlement window"
                  className={inputClass}
                  value={customValue}
                  onChange={(event) => {
                    setPreset(null)
                    setCustomValue(event.target.value)
                  }}
                />
                <select
                  aria-label="Settlement window unit"
                  className={`${inputClass} w-auto min-w-[112px]`}
                  value={unit}
                  onChange={(event) => {
                    setPreset(null)
                    setUnit(Number(event.target.value) as (typeof UNITS)[number]['seconds'])
                  }}
                >
                  {UNITS.map((option) => (
                    <option key={option.seconds} value={option.seconds}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-2 text-[11px] text-ink-400">
                {durationError ? <span className="text-warn">{durationError}</span> : 'The deadline is set when the trade is created.'}
              </p>
            </Field>

            {error && (
              <p className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad-soft px-3 py-2 text-xs text-bad">
                <AlertCircle {...icon} />
                {error}
              </p>
            )}

            <div className="border-t border-line pt-5">
              <WriteButton
                targetChain="lasna"
                onClick={submit}
                disabled={!!validation || isPending || submitting}
                primary
              >
                {submitting || isPending ? 'Creating trade' : 'Create trade'}
              </WriteButton>
              {validation && <span className="ml-3 text-[11px] text-ink-500">{validation}</span>}
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Order details">
          <div className="space-y-4">
            <Field label="Order ID" hint="32 bytes">
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value.trim())}
                  spellCheck={false}
                />
                <Button size="md" icon={<RefreshCw {...icon} />} onClick={() => setOrderId(randomOrderId())}>
                  Generate
                </Button>
              </div>
            </Field>
            <p
              className="-mt-3 text-[11px] leading-relaxed text-ink-400"
              title="Order IDs are generated locally from 32 random bytes (crypto.getRandomValues, with a Math.random fallback). createOrder rejects an ID that is already on-chain."
            >
              <span className="block">Generated in your browser · 32 random bytes</span>
              <span className="block">duplicates are rejected on-chain</span>
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Metric label="Deadline" value={deadline !== null ? formatDeadline(BigInt(deadline)) : '—'} />
              <Metric label="Window" value={validDuration !== null ? `${validDuration}s` : '—'} />
              <Metric label="Buyer" value={address ? truncate(address, 8, 6) : '—'} />
              <Metric label="Seller" value={normalizedSeller ? truncate(normalizedSeller, 8, 6) : '—'} />
              <Metric label="Payment leg" value={formatAmount(parsedPayment ?? 0n, paymentDecimals, paymentToken.symbol)} />
              <Metric label="Asset leg" value={formatAmount(parsedAsset ?? 0n, assetDecimals, assetToken.symbol)} />
            </div>
          </div>
        </Panel>

        <Panel title="Settlement trail">
          <ol className="space-y-4 text-xs text-ink-500">
            {[
              '01 Buyer locks payment on Base',
              '02 Seller locks the asset on Unichain',
              '03 One decision releases both legs',
            ].map((step) => (
              <li key={step}>
                <span className="tnum mr-3 font-mono text-ink-400">{step.slice(0, 2)}</span>
                {step.slice(3)}
              </li>
            ))}
          </ol>
          <p className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-[11px] text-ink-400">
            <ConvergenceMark className="h-4 w-4" />
            Proof is assembled from on-chain events, never seeded.
          </p>
        </Panel>
      </div>
    </div>
  )
}
