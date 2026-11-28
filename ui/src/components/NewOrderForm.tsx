import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseUnits, type Address, type Hex } from 'viem'
import { AlertCircle, Check, ChevronDown, RefreshCw } from 'lucide-react'
import { CHAIN_IDS, CHAIN_LABELS } from '../lib/chains'
import { configuredAddress, useConfig } from '../lib/config'
import { reactiveAbi } from '../lib/contracts'
import {
  formatAmount,
  formatDeadline,
  normalizeAddress,
  randomOrderId,
  toUnitString,
  truncate,
  ZERO_ADDRESS,
} from '../lib/format'
import { logClient } from '../lib/logs'
import { useTicketAssetPairs } from '../lib/assetPairs'
import { useErc20Balance } from '../lib/queries'
import { computeTermsHash } from '../lib/terms'
import { txToast } from '../lib/toasts'
import { useTradeTicket } from '../lib/tradeTicket'
import { useVenues } from '../lib/venues'
import { venueTuple } from '../lib/venue'
import { Button, ConvergenceMark, Field, Metric, Panel, inputClass, icon } from './ui'
import ConfirmModal from './ConfirmModal'
import WriteButton from './WriteButton'
import TradeTicket from './TradeTicket'

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
  const ticket = useTradeTicket()
  const config = useConfig()
  const venues = useVenues()
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const lasnaClient = logClient(usePublicClient({ chainId: CHAIN_IDS.lasna })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null

  const {
    paymentOptions,
    assetOptions,
    setPaymentChain,
    setAssetChain,
  } = useTicketAssetPairs()

  const paymentVenue = venues.byChain(ticket.paymentChain)
  const assetVenue = venues.byChain(ticket.assetChain)
  const paymentToken = ticket.tokenFor('payment')
  const assetToken = ticket.tokenFor('asset')

  const [orderId, setOrderId] = useState<string>(() => randomOrderId())
  const [seller, setSeller] = useState('')
  const [customValue, setCustomValue] = useState('120')
  const [unit, setUnit] = useState<(typeof UNITS)[number]['seconds']>(1)
  const [unitOpen, setUnitOpen] = useState(false)
  const [preset, setPreset] = useState<number | null>(120)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const normalizedSeller = normalizeAddress(seller)
  const openOrder = !normalizedSeller
  const sellerAddress = openOrder ? ZERO_ADDRESS : normalizedSeller
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

  const paymentDecimals = paymentToken?.decimals ?? 18
  const assetDecimals = assetToken?.decimals ?? 18
  const parsedPayment = useMemo(() => parseAmount(ticket.payAmount, paymentDecimals), [ticket.payAmount, paymentDecimals])
  const parsedAsset = useMemo(() => parseAmount(ticket.receiveAmount, assetDecimals), [ticket.receiveAmount, assetDecimals])

  const venue = venueTuple(paymentVenue, assetVenue)
  const rc = configuredAddress(config.reactive.reactiveContract)
  const paymentBalanceQuery = useErc20Balance(ticket.paymentChain, paymentToken?.address, address)
  const paymentBalance = paymentBalanceQuery.data

  const termsPreview = useMemo(() => {
    if (!venue || !paymentToken || !assetToken || !parsedPayment || !parsedAsset || !deadline) return null
    return computeTermsHash({
      buyer: (address ?? ZERO_ADDRESS) as Hex,
      seller: sellerAddress as Hex,
      paymentToken: paymentToken.address,
      paymentAmount: parsedPayment,
      assetToken: assetToken.address,
      assetAmount: parsedAsset,
      deadline: BigInt(deadline),
      venue,
    })
  }, [venue, paymentToken, assetToken, parsedPayment, parsedAsset, deadline, address, sellerAddress])

  const validation = useMemo(() => {
    if (!/^0x[a-fA-F0-9]{64}$/.test(orderId)) return 'Order ID must be 32 bytes: 0x followed by 64 hex characters.'
    if (seller.trim() && !normalizedSeller) return 'Enter a valid seller address.'
    if (!openOrder && address && normalizedSeller && normalizedSeller.toLowerCase() === address.toLowerCase()) {
      return 'The seller must differ from the buyer.'
    }
    if (!paymentToken || !assetToken) return 'Choose a token for both legs.'
    if (paymentToken.address.toLowerCase() === assetToken.address.toLowerCase() && ticket.paymentChain === ticket.assetChain) {
      return 'The two legs must be on different chains.'
    }
    if (
      !ticket.isConfirmedCustom(ticket.paymentChain, paymentToken.address) &&
      !paymentToken.verified
    ) {
      return 'Confirm the unverified payment token in its picker before creating the trade.'
    }
    if (
      !ticket.isConfirmedCustom(ticket.assetChain, assetToken.address) &&
      !assetToken.verified
    ) {
      return 'Confirm the unverified asset token in its picker before creating the trade.'
    }
    if (!parsedPayment) return 'Payment amount must be greater than zero.'
    if (!parsedAsset) return 'Asset amount must be greater than zero.'
    if (paymentBalance !== null && paymentBalance !== undefined && paymentBalance < parsedPayment) {
      return `Not enough ${paymentToken.symbol} to cover the payment leg.`
    }
    if (!rc || !venue) return 'Both chains need a registered venue on the reactive contract.'
    if (ticket.paymentChain === ticket.assetChain) return 'The payment and asset chains must differ.'
    if (durationError) return durationError
    return null
  }, [
    orderId, seller, normalizedSeller, openOrder, address, paymentToken, assetToken,
    parsedPayment, parsedAsset, paymentBalance, rc, venue, durationError,
    ticket.paymentChain, ticket.assetChain, ticket.isConfirmedCustom,
  ])

  async function submit() {
    if (validation || !venue || !paymentToken || !assetToken || !parsedPayment || !parsedAsset || !rc || !validDuration) {
      setError(validation ?? 'The trade ticket is incomplete.')
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
          sellerAddress as Hex,
          paymentToken.address,
          parsedPayment,
          BigInt(CHAIN_IDS[ticket.paymentChain]),
          venue.paymentEscrow,
          assetToken.address,
          parsedAsset,
          BigInt(CHAIN_IDS[ticket.assetChain]),
          venue.assetEscrow,
          BigInt(validDuration),
        ],
      })
      txToast('Create trade', hash, 'lasna', 'pending')
      await lasnaClient?.waitForTransactionReceipt({ hash })
      txToast('Create trade', hash, 'lasna', 'confirmed')
      navigate(`/orders/${orderId}?tx=${hash}`)
    } catch {
      setError('The trade could not be created. Check that both venues are registered and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 min-w-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="min-w-0 space-y-6">
        <Panel title="Trade ticket" subtitle="The connected wallet is the buyer" bodyClass="p-4 sm:p-5">
          <TradeTicket
            pay={{
              symbol: paymentToken?.symbol,
              chain: ticket.paymentChain,
              amount: ticket.payAmount,
              onAmountChange: ticket.setPayAmount,
              kind: 'payment',
              mark: paymentToken?.mark,
              color: paymentToken?.color,
              assetOptions: paymentOptions,
              selectedAddress: paymentToken?.address,
              onAssetChange: (token) => {
                ticket.selectToken('payment', token)
                setError(null)
              },
              onChainChange: (chain) => {
                setPaymentChain(chain)
                setError(null)
              },
              tokenAddress: paymentToken?.address,
              verified: paymentToken?.verified,
              hint:
                paymentBalance !== undefined && paymentBalance !== null
                  ? `${paymentToken?.name} · balance ${toUnitString(paymentBalance, paymentDecimals)} ${paymentToken?.symbol}`
                  : `${paymentToken?.name ?? 'Token'} · ${CHAIN_LABELS[ticket.paymentChain]} testnet`,
            }}
            receive={{
              symbol: assetToken?.symbol,
              chain: ticket.assetChain,
              amount: ticket.receiveAmount,
              onAmountChange: ticket.setReceiveAmount,
              kind: 'asset',
              mark: assetToken?.mark,
              color: assetToken?.color,
              assetOptions: assetOptions,
              selectedAddress: assetToken?.address,
              onAssetChange: (token) => {
                ticket.selectToken('asset', token)
                setError(null)
              },
              onChainChange: (chain) => {
                setAssetChain(chain)
                setError(null)
              },
              tokenAddress: assetToken?.address,
              verified: assetToken?.verified,
              hint: `${assetToken?.name ?? 'Token'} · ${CHAIN_LABELS[ticket.assetChain]} testnet`,
            }}
            onReverse={() => {
              ticket.flip()
              setError(null)
            }}
          />
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-400">
            Pick a chain and any curated token on each leg. Flip the arrow to reverse the ordered pair. Pasted ERC-20s are unverified until you confirm them.
          </p>

          <div className="mt-5 space-y-5 px-1">
            <Field label="Seller address" hint="Optional">
              <input
                className={inputClass}
                placeholder="0x… — leave blank for any seller"
                value={seller}
                onChange={(e) => setSeller(e.target.value)}
                spellCheck={false}
                aria-describedby="seller-hint"
              />
              <p id="seller-hint" className="mt-2 text-[11px] leading-relaxed text-ink-500">
                Leave blank to let any seller match. The first seller to lock the full asset amount wins; later locks are refunded.
              </p>
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
                <div className="relative w-auto min-w-[124px]">
                  <button
                    type="button"
                    aria-label="Settlement window unit"
                    aria-expanded={unitOpen}
                    aria-haspopup="listbox"
                    onClick={() => setUnitOpen((open) => !open)}
                    className={`${inputClass} flex w-full items-center justify-between gap-2 pr-3 text-left`}
                  >
                    <span>{UNITS.find((option) => option.seconds === unit)?.label ?? 'seconds'}</span>
                    <ChevronDown {...icon} className={`shrink-0 text-ink-400 transition-transform ${unitOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {unitOpen && (
                    <ul role="listbox" className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-line bg-paper-0 py-1 shadow-lg">
                      {UNITS.map((option) => (
                        <li key={option.seconds} role="option" aria-selected={option.seconds === unit}>
                          <button
                            type="button"
                            onClick={() => {
                              setPreset(null)
                              setUnit(option.seconds)
                              setUnitOpen(false)
                            }}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition-colors hover:bg-paper-100 ${
                              option.seconds === unit ? 'font-medium text-accent' : 'text-ink-700'
                            }`}
                          >
                            <span>{option.label}</span>
                            {option.seconds === unit ? <Check {...icon} /> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
                onClick={() => setConfirmOpen(true)}
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

      <div className="min-w-0 space-y-6">
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
            <p className="-mt-3 text-[11px] leading-relaxed text-ink-400">
              <span className="block">Generated in your browser · 32 random bytes</span>
              <span className="block">duplicates are rejected on-chain</span>
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Metric label="Deadline" value={deadline !== null ? formatDeadline(BigInt(deadline)) : '—'} />
              <Metric label="Window" value={validDuration !== null ? `${validDuration}s` : '—'} />
              <Metric label="Buyer" value={address ? truncate(address, 8, 6) : '—'} />
              <Metric label="Seller" value={openOrder ? 'Open to any seller' : normalizedSeller ? truncate(normalizedSeller, 8, 6) : '—'} />
              <Metric label="Payment leg" value={formatAmount(parsedPayment ?? 0n, paymentDecimals, paymentToken?.symbol)} />
              <Metric label="Asset leg" value={formatAmount(parsedAsset ?? 0n, assetDecimals, assetToken?.symbol)} />
            </div>
            <div className="border-t border-line pt-4">
              <p className="text-[11px] text-ink-400">Terms hash (venue-bound)</p>
              <p className="tnum mt-1 break-all font-mono text-[11px] text-ink-700" title={termsPreview ?? undefined}>
                {termsPreview ? truncate(termsPreview, 20, 12) : 'Complete the ticket to preview'}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-400">
                Both escrow legs must carry this hash. It includes the payment/asset chains and escrows, so a deposit cannot be replayed against another venue.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Settlement trail">
          <ol className="space-y-4 text-xs text-ink-500">
            {[
              `01 Buyer locks payment on ${CHAIN_LABELS[ticket.paymentChain]}`,
              openOrder
                ? `02 Any seller can lock the asset on ${CHAIN_LABELS[ticket.assetChain]}`
                : `02 Seller locks the asset on ${CHAIN_LABELS[ticket.assetChain]}`,
              openOrder ? '03 First valid lock pays the winner' : '03 One decision releases both legs',
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

      {confirmOpen && (
        <ConfirmModal
          title="Create this trade?"
          description="The order ID and all terms are fixed once the transaction is signed."
          details={[
            { label: 'Order ID', value: truncate(orderId, 12, 10) },
            { label: 'Payment', value: `${formatAmount(parsedPayment ?? 0n, paymentDecimals, paymentToken?.symbol)} · ${CHAIN_LABELS[ticket.paymentChain]}` },
            { label: 'Payment token', value: paymentToken?.address ?? '—' },
            { label: 'Asset', value: `${formatAmount(parsedAsset ?? 0n, assetDecimals, assetToken?.symbol)} · ${CHAIN_LABELS[ticket.assetChain]}` },
            { label: 'Asset token', value: assetToken?.address ?? '—' },
            { label: 'Counterparty', value: openOrder ? 'Open to any seller' : truncate(normalizedSeller ?? '', 10, 8) },
            { label: 'Deadline', value: deadline !== null ? formatDeadline(BigInt(deadline)) : '—' },
            { label: 'Terms hash', value: termsPreview ? truncate(termsPreview, 12, 10) : '—' },
            { label: 'Network', value: 'Reactive Lasna' },
          ]}
          gasNote="You will pay gas on Reactive Lasna to create the order. The backend never signs or holds your keys."
          tokenRisks={[
            {
              address: paymentToken?.address,
              decimals: paymentToken?.decimals,
              verified: paymentToken?.verified,
              source: paymentToken?.verified ? 'curated catalog' : 'custom ERC-20 (unverified)',
            },
            {
              address: assetToken?.address,
              decimals: assetToken?.decimals,
              verified: assetToken?.verified,
              source: assetToken?.verified ? 'curated catalog' : 'custom ERC-20 (unverified)',
            },
          ]}
          confirmLabel="Create trade"
          busy={submitting || isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false)
            void submit()
          }}
        />
      )}
    </div>
  )
}
