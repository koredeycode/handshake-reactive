import type { ReactNode } from 'react'
import { useAccount, useChainId, useConnect, useSwitchChain } from 'wagmi'
import { ArrowLeftRight, Wallet } from 'lucide-react'
import { CHAIN_IDS, CHAIN_LABELS } from '../lib/chains'
import { txToast } from '../lib/toasts'
import { Button, icon } from './ui'
import type { ChainKey } from '../lib/chains'
import type { Hex } from 'viem'

export interface TxNotice {
  label: string
  hash: Hex
  chain: ChainKey
  status: 'pending' | 'confirmed' | 'error'
}

export default function WriteButton({
  targetChain,
  children,
  onClick,
  disabled,
  title,
  primary = false,
}: {
  targetChain: ChainKey
  children: ReactNode
  onClick: () => void | Promise<void>
  disabled?: boolean
  title?: string
  primary?: boolean
}) {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { connectors, connect } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const wrongChain = chainId !== CHAIN_IDS[targetChain]

  if (!isConnected) {
    return (
      <Button
        variant="primary"
        size="sm"
        icon={<Wallet {...icon} />}
        onClick={() => connectors[0] && connect({ connector: connectors[0] })}
      >
        <span className="hidden sm:inline">Connect wallet</span>
        <span className="sm:hidden">Connect</span>
      </Button>
    )
  }

  if (wrongChain) {
    return (
      <Button
        size="sm"
        icon={<ArrowLeftRight {...icon} />}
        onClick={() => {
          void switchChainAsync({ chainId: CHAIN_IDS[targetChain] }).catch((error: unknown) => {
            txToast('Switch network', '0x', targetChain, 'error', error)
          })
        }}
      >
        Switch to {CHAIN_LABELS[targetChain]}
      </Button>
    )
  }

  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="sm"
      onClick={() => void onClick()}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  )
}
