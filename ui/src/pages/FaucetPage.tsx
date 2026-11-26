import { useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseUnits, type Address, type Hex } from 'viem'
import WriteButton, { type TxNotice } from '../components/WriteButton'
import { Button, ChainMark, ChainPill, ExternalLink, TokenMark, TxLink, inputClass } from '../components/ui'
import { CHAIN_IDS, CHAIN_LABELS } from '../lib/chains'
import { mintAbi } from '../lib/contracts'
import { formatAmount } from '../lib/format'
import { logClient } from '../lib/logs'
import {
  FORWARD_MARKET_ID,
  REVERSE_MARKET_ID,
  chainKeyFromId,
  useMarkets,
} from '../lib/markets'
import { useErc20Balance } from '../lib/queries'
import { findTokenEntry, useTokenRegistry } from '../lib/tokenDisplay'
import type { ChainKey } from '../lib/chains'
import type { Market } from '../lib/markets'

interface FaucetToken {
  chain: ChainKey
  address: string
  role: 'payment' | 'asset'
}

function tokensForMarket(market: Market): FaucetToken[] {
  return (['payment', 'asset'] as const).map((role) => {
    const leg = market[role]
    return {
      chain: chainKeyFromId(leg.chainId, leg.chainKey),
      address: leg.token,
      role,
    }
  })
}

function GasLinks({ chain }: { chain: ChainKey }) {
  const links = [
    { label: 'Alchemy', href: `https://www.alchemy.com/faucets/${chain === 'base' ? 'base-sepolia' : 'unichain-sepolia'}` },
    { label: 'ZalalenA', href: `https://faucet.zalalena.com/${chain === 'base' ? 'base' : 'unichain'}` },
    { label: 'Superchain', href: 'https://app.optimism.io/faucet' },
  ]
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {links.map((link) => (
        <ExternalLink key={link.label} href={link.href} className="inline-flex min-h-10 items-center text-[12px]">
          {link.label}
        </ExternalLink>
      ))}
    </div>
  )
}

function FaucetCard({ token }: { token: FaucetToken }) {
  const registry = useTokenRegistry()
  const { address } = useAccount()
  const { writeContractAsync, isPending } = useWriteContract()
  const client = logClient(usePublicClient({ chainId: CHAIN_IDS[token.chain] })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null
  const balance = useErc20Balance(token.chain, token.address, address)
  const entry = findTokenEntry(registry.data, token.chain, token.address)
  const symbol = entry?.symbol ?? (token.role === 'payment' ? 'tUSD' : 'tASSET')
  const decimals = entry?.decimals ?? (token.role === 'payment' ? 6 : 18)
  const [amount, setAmount] = useState(token.role === 'payment' ? '1000' : '100')
  const [notice, setNotice] = useState<TxNotice | null>(null)

  let parsed: bigint | null = null
  try {
    const candidate = parseUnits(amount.trim(), decimals)
    if (candidate > 0n) parsed = candidate
  } catch {
    parsed = null
  }

  async function mint() {
    if (!address || !parsed) {
      setNotice({ label: 'Mint', hash: '0x', chain: token.chain, status: 'error' })
      return
    }
    const label = `Mint ${symbol}`
    try {
      const hash = await writeContractAsync({
        address: token.address as Address,
        abi: mintAbi,
        functionName: 'mint',
        args: [address, parsed],
      })
      setNotice({ label, hash, chain: token.chain, status: 'pending' })
      await client?.waitForTransactionReceipt({ hash })
      setNotice({ label, hash, chain: token.chain, status: 'confirmed' })
      void balance.refetch()
    } catch {
      setNotice({ label, hash: '0x', chain: token.chain, status: 'error' })
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-paper-0 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenMark
            symbol={symbol}
            kind={token.role === 'payment' ? 'payment' : 'asset'}
            mark={entry?.mark}
            color={entry?.color}
            size="lg"
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-ink-900">{entry?.name ?? symbol}</h3>
            <p className="mt-0.5 text-[12px] text-ink-400">{symbol} · {decimals} decimals</p>
          </div>
        </div>
        <ChainPill chain={token.chain} />
      </div>

      <div className="mt-6 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-end sm:gap-3">
        <div>
          <div className="text-[12px] text-ink-400">Your balance</div>
          <div className="tnum mt-1 font-mono text-xl text-ink-900">
            {formatAmount(balance.data, decimals, symbol)}
          </div>
        </div>
        <span className="text-[12px] text-ink-400">{CHAIN_LABELS[token.chain]}</span>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <label className="block">
          <span className="mb-2 flex items-baseline justify-between text-xs font-medium text-ink-700">
            <span>Amount to mint</span>
            <span className="text-[11px] font-normal text-ink-400">{symbol}</span>
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
          <WriteButton targetChain={token.chain} onClick={mint} disabled={!parsed || isPending} primary>
            {isPending ? 'Minting' : `Mint ${symbol}`}
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
  const markets = useMarkets()
  const forward = markets.find((market) => market.id === FORWARD_MARKET_ID)
  const reverse = markets.find((market) => market.id === REVERSE_MARKET_ID)
  const groups = [
    forward && {
      id: FORWARD_MARKET_ID,
      label: 'Base Sepolia → Unichain Sepolia',
      tokens: tokensForMarket(forward),
    },
    reverse && {
      id: REVERSE_MARKET_ID,
      label: 'Unichain Sepolia → Base Sepolia',
      tokens: tokensForMarket(reverse),
    },
  ].filter((group): group is { id: string; label: string; tokens: FaucetToken[] } => !!group)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-medium text-ink-900">Faucet</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
          Test tokens for both trade directions, on their native chains. Each token is local to its chain; these are testnet tokens with no value.
        </p>
      </div>

      {!groups.length && (
        <p className="text-xs text-ink-500">Token configuration is unavailable in this workspace.</p>
      )}

      {groups.map((group) => {
        const chains = Array.from(new Set(group.tokens.map((token) => token.chain)))
        return (
          <section key={group.id} className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                <ChainMark chain={chains[0]} /> {CHAIN_LABELS[chains[0]]}
              </span>
              <span className="text-ink-400">→</span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
                <ChainMark chain={chains[1]} /> {CHAIN_LABELS[chains[1]]}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {group.tokens.map((token) => (
                <FaucetCard key={`${token.chain}:${token.address}`} token={token} />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {chains.map((chain) => (
                <div key={chain} className="rounded-xl border border-line bg-paper-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink-900">
                      Native gas · {CHAIN_LABELS[chain]}
                    </span>
                    <ChainPill chain={chain} />
                  </div>
                  <div className="mt-3"><GasLinks chain={chain} /></div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
