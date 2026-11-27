import { useState } from 'react'
import { useAccount, useChainId, useConnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { parseUnits, type Address, type Hex } from 'viem'
import type { TxNotice } from '../components/WriteButton'
import { Button, ChainMark, ExternalLink, TokenMark, TxLink, inputClass } from '../components/ui'
import { CHAIN_IDS, CHAIN_LABELS, GAS_LINKS, TRADING_CHAIN_KEYS, type TradingChainKey } from '../lib/chains'
import { mintAbi } from '../lib/contracts'
import { formatAmount } from '../lib/format'
import { logClient } from '../lib/logs'
import { useErc20Balance } from '../lib/queries'
import { useChainTokens, type ChainTokenOption } from '../lib/tokenDisplay'
import { UNVERIFIED_LABEL, useTradeTicket } from '../lib/tradeTicket'

function GasLinks({ chain }: { chain: TradingChainKey }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {GAS_LINKS[chain].map((link) => (
        <ExternalLink key={link.label} href={link.href} className="inline-flex min-h-8 items-center text-[11px]">
          {link.label}
        </ExternalLink>
      ))}
    </div>
  )
}

/** One card: chain, asset, amount, then switch / mint. */
export default function FaucetPage() {
  const { customTokens } = useTradeTicket()
  const [chain, setChain] = useState<TradingChainKey>('base')
  const [tokenAddress, setTokenAddress] = useState<string | null>(null)
  const [amount, setAmount] = useState('1000')
  const [notice, setNotice] = useState<TxNotice | null>(null)
  const curated = useChainTokens(chain, true)
  const discovered: ChainTokenOption[] = (customTokens[chain] ?? []).map((token) => ({
    address: token.address,
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    mark: token.mark,
    color: token.color,
    verified: false,
  }))
  const tokens = [...curated, ...discovered]
  const token = tokens.find((entry) => entry.address === tokenAddress) ?? tokens[0]

  const { address, isConnected } = useAccount()
  const connectedChainId = useChainId()
  const { connectors, connect, isPending: isConnecting } = useConnect()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const { writeContractAsync, isPending } = useWriteContract()
  const client = logClient(usePublicClient({ chainId: CHAIN_IDS[chain] })) as unknown as {
    waitForTransactionReceipt: (args: { hash: Hex }) => Promise<unknown>
  } | null
  const balance = useErc20Balance(chain, token?.address, address)

  const wrongChain = isConnected && connectedChainId !== CHAIN_IDS[chain]
  const mintable = !!token?.verified && !token.placeholder
  let parsed: bigint | null = null
  if (token) {
    try {
      const candidate = parseUnits(amount.trim(), token.decimals)
      if (candidate > 0n) parsed = candidate
    } catch {
      parsed = null
    }
  }

  function chooseChain(next: TradingChainKey) {
    if (next === chain) return
    setChain(next)
    setTokenAddress(null)
    setNotice(null)
  }

  async function mint() {
    if (!token || !address || !parsed || !mintable) return
    try {
      const hash = await writeContractAsync({
        address: token.address as Address,
        abi: mintAbi,
        functionName: 'mint',
        args: [address, parsed],
      })
      setNotice({ label: `Mint ${token.symbol}`, hash, chain, status: 'pending' })
      await client?.waitForTransactionReceipt({ hash })
      setNotice({ label: `Mint ${token.symbol}`, hash, chain, status: 'confirmed' })
      void balance.refetch()
    } catch {
      setNotice({ label: 'Mint', hash: '0x', chain, status: 'error' })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-ink-900">Faucet</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
          Mint our test tokens on the chain you select. Each token is local to its chain. Other tokens show a balance but are not mintable here.
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-paper-0 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-[12px] font-medium text-accent-ink">1</span>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-ink-900">Choose a chain</h2>
            <p className="text-[11px] text-ink-400">Where the tokens will be minted</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TRADING_CHAIN_KEYS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === chain}
              onClick={() => chooseChain(option)}
              className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border px-2 text-[12px] transition-colors ${
                option === chain
                  ? 'border-accent/25 bg-accent-soft font-medium text-accent-ink'
                  : 'border-line bg-paper-0 text-ink-500 hover:bg-paper-100'
              }`}
            >
              <ChainMark chain={option} />
              <span className="truncate">{CHAIN_LABELS[option]}</span>
            </button>
          ))}
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-[12px] font-medium text-accent-ink">2</span>
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-ink-900">Choose an asset</h2>
              <p className="text-[11px] text-ink-400">Tokens available on {CHAIN_LABELS[chain]}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {tokens.map((entry) => {
              const active = entry.address === token?.address
              return (
                <button
                  key={`${chain}:${entry.address}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setTokenAddress(entry.address)
                    setNotice(null)
                  }}
                  className={`flex min-h-12 min-w-0 max-w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    active ? 'border-accent/25 bg-accent-soft' : 'border-line bg-paper-0 hover:bg-paper-100'
                  }`}
                >
                  <TokenMark symbol={entry.symbol} mark={entry.mark} color={entry.color} size="sm" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="block truncate text-[12px] font-medium text-ink-900">{entry.symbol}</span>
                      {!entry.verified && (
                        <span className="rounded-full border border-warn/25 bg-warn-soft px-1.5 py-0.5 text-[9px] text-warn">{UNVERIFIED_LABEL}</span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-ink-400">
                      {entry.name} · {entry.decimals} decimals
                    </span>
                  </span>
                </button>
              )
            })}
            {tokens.length === 0 && <p className="text-[11px] text-ink-500">Token metadata is unavailable.</p>}
          </div>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-[12px] font-medium text-accent-ink">3</span>
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-ink-900">Mint tokens</h2>
              <p className="text-[11px] text-ink-400">Amount and balance on {CHAIN_LABELS[chain]}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-ink-400">Your balance</div>
              <div className="tnum mt-1 font-mono text-lg text-ink-900">
                {token ? formatAmount(balance.data, token.decimals, token.symbol) : '—'}
              </div>
            </div>
            {token && <span className="text-[11px] text-ink-400">{token.name} · {token.symbol}</span>}
          </div>

          {token && !mintable && (
            <p className="mt-3 rounded-xl border border-warn/25 bg-warn-soft px-3 py-2 text-[11px] text-warn">
              {token.placeholder
                ? 'Deployment pending — fill the Sepolia token addresses from the deploy manifest (SEPOLIA_TOKEN_ADDRESSES / VITE_SEPOLIA_*).'
                : `${token.symbol} is not mintable here. It is a custom token with a ${UNVERIFIED_LABEL.toLowerCase()} contract; its balance is read from chain.`}
            </p>
          )}

          <label className="mt-4 block">
            <span className="mb-2 flex items-baseline justify-between text-xs font-medium text-ink-700">
              <span>Amount to mint</span>
              <span className="text-[11px] font-normal text-ink-400">{token?.symbol ?? '—'}</span>
            </span>
            <input
              className={inputClass}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              spellCheck={false}
              aria-label="Amount to mint"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void mint()}
              disabled={!isConnected || wrongChain || !parsed || !token || !mintable || isPending}
            >
              {isPending ? 'Minting' : `Mint ${token?.symbol ?? ''}`}
            </Button>
            {!isConnected && (
              <Button size="sm" onClick={() => connectors[0] && connect({ connector: connectors[0] })} disabled={!connectors[0] || isConnecting}>
                {isConnecting ? 'Connecting' : 'Connect wallet'}
              </Button>
            )}
            {wrongChain && (
              <Button size="sm" onClick={() => void switchChainAsync({ chainId: CHAIN_IDS[chain] })} disabled={isSwitching}>
                {isSwitching ? 'Switching chain' : `Switch to ${CHAIN_LABELS[chain]}`}
              </Button>
            )}
            {mintable && !parsed && <span className="text-[11px] text-ink-500">Enter an amount greater than zero.</span>}
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
                  {notice.hash !== '0x' && <span className="ml-2"><TxLink chain={notice.chain} hash={notice.hash} /></span>}
                </>
              )}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4">
            <span className="text-[11px] text-ink-400">Need gas?</span>
            <GasLinks chain={chain} />
          </div>
        </div>
      </section>
    </div>
  )
}
