import { useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseUnits, type Address, type Hex } from 'viem'
import WriteButton, { type TxNotice } from '../components/WriteButton'
import { Button, ChainPill, ExternalLink, Panel, TokenMark, TxLink, inputClass } from '../components/ui'
import { CHAIN_IDS, CHAIN_LABELS } from '../lib/chains'
import { mintAbi } from '../lib/contracts'
import { logClient } from '../lib/logs'
import { formatAmount } from '../lib/format'
import { useTokenBalance } from '../lib/queries'
import { useTokenDisplay } from '../lib/tokenDisplay'
import type { LegKind } from '../lib/queries'
import type { ChainKey } from '../lib/chains'

function GasLinks({ chain }: { chain: ChainKey }) {
  const links = [
    { label: 'Alchemy', href: `https://www.alchemy.com/faucets/${chain === 'base' ? 'base-sepolia' : 'unichain-sepolia'}` },
    { label: 'ZalalenA', href: `https://faucet.zalalena.com/${chain === 'base' ? 'base' : 'unichain'}` },
    { label: 'Superchain', href: 'https://app.optimism.io/faucet' },
  ]
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {links.map((link) => (
        <ExternalLink key={link.label} href={link.href} className="text-[11px]">
          {link.label}
        </ExternalLink>
      ))}
    </div>
  )
}

function FaucetCard({ kind }: { kind: LegKind }) {
  const display = useTokenDisplay(kind)
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const chainKey: ChainKey = kind === 'payment' ? 'base' : 'unichain'
  const client = logClient(usePublicClient({ chainId: CHAIN_IDS[chainKey] })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null
  const balance = useTokenBalance(kind, address)
  const [amount, setAmount] = useState(kind === 'payment' ? '1000' : '100')
  const [notice, setNotice] = useState<TxNotice | null>(null)

  let parsed: bigint | null = null
  try {
    const candidate = parseUnits(amount.trim(), display.decimals)
    if (candidate > 0n) parsed = candidate
  } catch {
    parsed = null
  }

  async function mint() {
    if (!address || !parsed || !display.address) {
      setNotice({ label: 'Mint', hash: '0x', chain: chainKey, status: 'error' })
      return
    }
    const label = `Mint ${display.symbol}`
    try {
      const hash = await writeContractAsync({
        address: display.address as Address,
        abi: mintAbi,
        functionName: 'mint',
        args: [address, parsed],
      })
      setNotice({ label, hash, chain: chainKey, status: 'pending' })
      await client?.waitForTransactionReceipt({ hash })
      setNotice({ label, hash, chain: chainKey, status: 'confirmed' })
      void balance.refetch()
    } catch {
      setNotice({ label, hash: '0x', chain: chainKey, status: 'error' })
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-paper-0 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <TokenMark symbol={display.symbol} kind={kind === 'payment' ? 'payment' : 'asset'} mark={display.mark} color={display.color} size="lg" />
          <div>
            <h3 className="text-sm font-medium text-ink-900">{display.name}</h3>
            <p className="mt-0.5 text-[11px] text-ink-400">{display.symbol} · testnet token</p>
          </div>
        </div>
        <ChainPill chain={chainKey} />
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] text-ink-400">Your balance</div>
          <div className="tnum mt-1 font-mono text-xl text-ink-900">
            {formatAmount(balance.data, display.decimals, display.symbol)}
          </div>
        </div>
        <span className="text-[11px] text-ink-400">{CHAIN_LABELS[chainKey]}</span>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <label className="block">
          <span className="mb-2 flex items-baseline justify-between text-xs font-medium text-ink-700">
            <span>Amount to mint</span>
            <span className="text-[11px] font-normal text-ink-400">{display.symbol}</span>
          </span>
          <input
            className={inputClass}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <WriteButton targetChain={chainKey} onClick={mint} disabled={!parsed || isPending} primary>
            {isPending ? 'Minting' : `Mint ${display.symbol}`}
          </WriteButton>
          {!parsed && <span className="text-[11px] text-ink-500">Enter an amount greater than zero.</span>}
          <Button size="sm" onClick={() => void balance.refetch()}>Refresh balance</Button>
        </div>
        {notice && (
          <p className="mt-4 text-[11px]">
            {notice.status === 'error' ? (
              <span className="text-bad">The mint did not complete. Try again.</span>
            ) : (
              <>
                <span className={notice.status === 'confirmed' ? 'text-good' : 'text-ink-500'}>
                  {notice.label} {notice.status === 'confirmed' ? 'confirmed' : 'submitted'}
                </span>
                {notice.hash !== '0x' && (
                  <span className="ml-2"><TxLink chain={notice.chain} hash={notice.hash} /></span>
                )}
              </>
            )}
          </p>
        )}
      </div>
    </section>
  )
}

export default function FaucetPage() {
  const payment = useTokenDisplay('payment')
  const asset = useTokenDisplay('asset')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-ink-900">Faucet</h1>
        <p className="mt-1 text-xs text-ink-500">
          Mint {payment.name} ({payment.symbol}) on Base Sepolia and {asset.name} ({asset.symbol}) on Unichain Sepolia.
          These are testnet tokens with no value.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FaucetCard kind="payment" />
        <FaucetCard kind="asset" />
      </div>

      <Panel title="Native ETH for gas" subtitle="Minting is a transaction, so each chain still needs a little native ETH">
        <div className="grid gap-4 md:grid-cols-2">
          {(['base', 'unichain'] as const).map((chain) => (
            <div key={chain} className="rounded-xl border border-line bg-paper-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-900">{CHAIN_LABELS[chain]}</span>
                <ChainPill chain={chain} />
              </div>
              <div className="mt-3">
                <GasLinks chain={chain} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
