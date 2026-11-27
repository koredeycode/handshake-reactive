/**
 * Minimal ABIs for the surfaces the console reads and writes (full Option B).
 * ONE HandshakeReactive on Lasna; escrows are token-agnostic and discovered
 * from the reactive venue registry. No bytecode addresses live here: see
 * public/markets.json + VITE_* overrides.
 */

const venueComponents = [
  { name: 'paymentChainId', type: 'uint256' },
  { name: 'paymentEscrow', type: 'address' },
  { name: 'assetChainId', type: 'uint256' },
  { name: 'assetEscrow', type: 'address' },
] as const

export const reactiveAbi = [
  {
    type: 'function',
    name: 'orderCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'orderIds',
    stateMutability: 'view',
    inputs: [{ name: 'index_', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getOrder',
    stateMutability: 'view',
    inputs: [{ name: 'orderId_', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'buyer', type: 'address' },
          { name: 'seller', type: 'address' },
          { name: 'paymentToken', type: 'address' },
          { name: 'paymentAmount', type: 'uint256' },
          { name: 'assetToken', type: 'address' },
          { name: 'assetAmount', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'paymentSeen', type: 'bool' },
          { name: 'assetSeen', type: 'bool' },
          { name: 'settleRequested', type: 'bool' },
          { name: 'refundRequested', type: 'bool' },
          { name: 'paymentClosed', type: 'bool' },
          { name: 'assetClosed', type: 'bool' },
          { name: 'paymentRefundRequested', type: 'bool' },
          { name: 'assetRefundRequested', type: 'bool' },
          { name: 'invalid', type: 'bool' },
          { name: 'nonce', type: 'uint64' },
          { name: 'lastActionTimestamp', type: 'uint256' },
          { name: 'winner', type: 'address' },
          { name: 'assetLockCount', type: 'uint8' },
          { name: 'paymentRequestNonce', type: 'uint64' },
          { name: 'assetRequestNonce', type: 'uint64' },
          { name: 'venue', type: 'tuple', components: venueComponents },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'venue',
    stateMutability: 'view',
    inputs: [{ name: 'chainId_', type: 'uint256' }],
    outputs: [
      { name: 'paymentEscrow_', type: 'address' },
      { name: 'assetEscrow_', type: 'address' },
      { name: 'registered_', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'registeredChainIds',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'subscriptionCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'escrows',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint8' },
      { name: '', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'termsHash',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'createOrder',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId_', type: 'bytes32' },
      { name: 'seller_', type: 'address' },
      { name: 'paymentToken_', type: 'address' },
      { name: 'paymentAmount_', type: 'uint256' },
      { name: 'paymentChainId_', type: 'uint256' },
      { name: 'paymentEscrow_', type: 'address' },
      { name: 'assetToken_', type: 'address' },
      { name: 'assetAmount_', type: 'uint256' },
      { name: 'assetChainId_', type: 'uint256' },
      { name: 'assetEscrow_', type: 'address' },
      { name: 'durationSeconds_', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'retry',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId_', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelOrder',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId_', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'coverDebt',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setVenue',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'chainId_', type: 'uint256' },
      { name: 'paymentEscrow_', type: 'address' },
      { name: 'assetEscrow_', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unsubscribeAll',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

const legComponents = [
  { name: 'depositor', type: 'address' },
  { name: 'counterparty', type: 'address' },
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'termsHash', type: 'bytes32' },
  { name: 'deadline', type: 'uint256' },
  { name: 'state', type: 'uint8' },
  { name: 'nonce', type: 'uint64' },
] as const

export const paymentEscrowAbi = [
  {
    type: 'function',
    name: 'getLeg',
    stateMutability: 'view',
    inputs: [{ name: 'orderId_', type: 'bytes32' }],
    outputs: [{ name: '', type: 'tuple', components: legComponents }],
  },
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId_', type: 'bytes32' },
      { name: 'token_', type: 'address' },
      { name: 'amount_', type: 'uint256' },
      { name: 'counterparty_', type: 'address' },
      { name: 'termsHash_', type: 'bytes32' },
      { name: 'deadline_', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

/** Race-mode asset escrow: legs keyed by (orderId, seller). */
export const assetEscrowAbi = [
  {
    type: 'function',
    name: 'getLeg',
    stateMutability: 'view',
    inputs: [
      { name: 'orderId_', type: 'bytes32' },
      { name: 'seller_', type: 'address' },
    ],
    outputs: [{ name: '', type: 'tuple', components: legComponents }],
  },
  {
    type: 'function',
    name: 'sellersOf',
    stateMutability: 'view',
    inputs: [{ name: 'orderId_', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId_', type: 'bytes32' },
      { name: 'token_', type: 'address' },
      { name: 'amount_', type: 'uint256' },
      { name: 'counterparty_', type: 'address' },
      { name: 'termsHash_', type: 'bytes32' },
      { name: 'deadline_', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

/** Public testnet mint(address,uint256) exposed by our own demo tokens only. */
export const mintAbi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export const payerAbi = [
  {
    type: 'function',
    name: 'debt',
    stateMutability: 'view',
    inputs: [{ name: 'contract_', type: 'address' }],
    outputs: [{ name: 'debt_', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'reserves',
    stateMutability: 'view',
    inputs: [{ name: 'contract_', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/** Event ABIs used by the log-sourced proof resolver and event log. */
export const paymentLockedEvent = {
  type: 'event',
  name: 'PaymentLocked',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true },
    { name: 'depositor', type: 'address', indexed: true },
    { name: 'counterparty', type: 'address', indexed: true },
    { name: 'token', type: 'address', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'termsHash', type: 'bytes32', indexed: false },
    { name: 'deadline', type: 'uint256', indexed: false },
  ],
} as const

export const assetLockedEvent = {
  type: 'event',
  name: 'AssetLocked',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true },
    { name: 'depositor', type: 'address', indexed: true },
    { name: 'counterparty', type: 'address', indexed: true },
    { name: 'token', type: 'address', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'termsHash', type: 'bytes32', indexed: false },
    { name: 'deadline', type: 'uint256', indexed: false },
  ],
} as const

export const paymentReleasedEvent = {
  type: 'event',
  name: 'PaymentReleased',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true },
    { name: 'recipient', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'nonce', type: 'uint64', indexed: false },
  ],
} as const

export const assetReleasedEvent = {
  type: 'event',
  name: 'AssetReleased',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true },
    { name: 'recipient', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'nonce', type: 'uint64', indexed: false },
  ],
} as const

export const paymentRefundedEvent = {
  type: 'event',
  name: 'PaymentRefunded',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true },
    { name: 'depositor', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'nonce', type: 'uint64', indexed: false },
  ],
} as const

export const assetRefundedEvent = {
  type: 'event',
  name: 'AssetRefunded',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true },
    { name: 'depositor', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'nonce', type: 'uint64', indexed: false },
  ],
} as const

/** OrderStateChanged(bytes32 indexed orderId, string stage, uint64 nonce). */
export const orderStateChangedEvent = {
  type: 'event',
  name: 'OrderStateChanged',
  inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true },
    { name: 'stage', type: 'string', indexed: false },
    { name: 'nonce', type: 'uint64', indexed: false },
  ],
} as const

/**
 * CallbackRequest.configuration is `abi.encode(CallbackConfiguration_V_1_0)`:
 * a bytes blob containing an offset to a struct tuple, so it must be decoded
 * as a tuple, never as four flat parameters.
 */
export const callbackConfigTuple = [
  {
    type: 'tuple',
    components: [
      { name: 'chainId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'gasLimit', type: 'uint64' },
      { name: 'payload', type: 'bytes' },
    ],
  },
] as const

/** Emitted by the Reactive system contract (0x8888…8888) on Lasna. */
export const callbackRequestEvent = {
  type: 'event',
  name: 'CallbackRequest',
  inputs: [
    { name: 'chainId', type: 'uint256', indexed: true },
    { name: 'sender', type: 'address', indexed: true },
    { name: 'recipient', type: 'address', indexed: true },
    { name: 'version', type: 'uint8', indexed: false },
    { name: 'configuration', type: 'bytes', indexed: false },
  ],
} as const

export const cron10Event = {
  type: 'event',
  name: 'Cron10',
  inputs: [{ name: 'number', type: 'uint256', indexed: false }],
} as const

/** Callback payloads injected by the RC; first arg is always the sender slot. */
export const callbackPayloadAbi = [
  {
    type: 'function',
    name: 'release',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'reactive_', type: 'address' },
      { name: 'orderId_', type: 'bytes32' },
      { name: 'recipient_', type: 'address' },
      { name: 'amount_', type: 'uint256' },
      { name: 'nonce_', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'release',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'reactive_', type: 'address' },
      { name: 'orderId_', type: 'bytes32' },
      { name: 'seller_', type: 'address' },
      { name: 'recipient_', type: 'address' },
      { name: 'amount_', type: 'uint256' },
      { name: 'nonce_', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'reactive_', type: 'address' },
      { name: 'orderId_', type: 'bytes32' },
      { name: 'seller_', type: 'address' },
      { name: 'nonce_', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'reactive_', type: 'address' },
      { name: 'orderId_', type: 'bytes32' },
      { name: 'nonce_', type: 'uint64' },
    ],
    outputs: [],
  },
] as const
