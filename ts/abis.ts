import { parseAbi, parseAbiItem, type AbiParameter } from 'viem';

/**
 * Single place for every ABI used by the TypeScript tooling.
 * Mirrors src/HandshakeReactive.sol, src/PaymentEscrow.sol and src/AssetEscrow.sol.
 * Keep in sync with ui/src/lib/contracts.ts (owned by the UI workstream).
 */

/** `Venue` struct stored inside every Order on the single reactive contract. */
const venueComponents = [
  { name: 'paymentChainId', type: 'uint256' },
  { name: 'paymentEscrow', type: 'address' },
  { name: 'assetChainId', type: 'uint256' },
  { name: 'assetEscrow', type: 'address' },
] as const;

/** 23-field Order tuple, including the trailing `venue` tuple. */
const orderGetter = {
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
} as const;

/** Both escrows expose the same 8-field `Leg` tuple. */
const legComponents = [
  { name: 'depositor', type: 'address' },
  { name: 'counterparty', type: 'address' },
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'termsHash', type: 'bytes32' },
  { name: 'deadline', type: 'uint256' },
  { name: 'state', type: 'uint8' },
  { name: 'nonce', type: 'uint64' },
] as const;

const paymentLegGetter = {
  type: 'function',
  name: 'getLeg',
  stateMutability: 'view',
  inputs: [{ name: 'orderId_', type: 'bytes32' }],
  outputs: [{ name: '', type: 'tuple', components: legComponents }],
} as const;

const assetLegGetter = {
  type: 'function',
  name: 'getLeg',
  stateMutability: 'view',
  inputs: [
    { name: 'orderId_', type: 'bytes32' },
    { name: 'seller_', type: 'address' },
  ],
  outputs: [{ name: '', type: 'tuple', components: legComponents }],
} as const;

export const reactiveAbi = [
  ...parseAbi([
    // Per-chain venue registry (one reactive contract serves every venue).
    'function setVenue(uint256 chainId_, address paymentEscrow_, address assetEscrow_)',
    'function venue(uint256 chainId_) view returns (address paymentEscrow_, address assetEscrow_, bool registered_)',
    'function registeredChainIds() view returns (uint256[] chainIds_)',
    'function subscriptionCount() view returns (uint256 count_)',
    'function escrows(address escrow_) view returns (uint256 chainId_, uint8 role_, bool registered_)',
    'function cronSubscribed() view returns (bool)',
    // Order lifecycle. createOrder carries both venue chain ids and escrow addresses.
    'function createOrder(bytes32 orderId_, address seller_, address paymentToken_, uint256 paymentAmount_, uint256 paymentChainId_, address paymentEscrow_, address assetToken_, uint256 assetAmount_, uint256 assetChainId_, address assetEscrow_, uint256 durationSeconds_)',
    'function cancelOrder(bytes32 orderId_)',
    'function retry(bytes32 orderId_)',
    'function termsHash(bytes32 orderId_) view returns (bytes32)',
    'function isClosed(bytes32 orderId_) view returns (bool)',
    'function orderCount() view returns (uint256)',
    'function orderIds(uint256 index_) view returns (bytes32)',
    'function sweepCursor() view returns (uint256)',
    'function coverDebt()',
    'function unsubscribeAll()',
    // `stage` is a string ("CREATED", "PAYMENT_SEEN", "SETTLE_REQUESTED", ...).
    'event OrderStateChanged(bytes32 indexed orderId, string stage, uint64 nonce)',
    'event VenueRegistered(uint256 indexed chainId, address paymentEscrow, address assetEscrow)',
    'event VenueUnregistered(uint256 indexed chainId, address paymentEscrow, address assetEscrow)',
  ]),
  orderGetter,
] as const;

const escrowLock =
  'function lock(bytes32 orderId_, address token_, uint256 amount_, address counterparty_, bytes32 termsHash_, uint256 deadline_)';

/** Lock/terminal event shapes are identical on both escrows. */
const escrowEvents = [
  'event PaymentLocked(bytes32 indexed orderId, address indexed depositor, address indexed counterparty, address token, uint256 amount, bytes32 termsHash, uint256 deadline)',
  'event AssetLocked(bytes32 indexed orderId, address indexed depositor, address indexed counterparty, address token, uint256 amount, bytes32 termsHash, uint256 deadline)',
  'event PaymentReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce)',
  'event AssetReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce)',
  'event PaymentRefunded(bytes32 indexed orderId, address indexed depositor, uint256 amount, uint64 nonce)',
  'event AssetRefunded(bytes32 indexed orderId, address indexed depositor, uint256 amount, uint64 nonce)',
] as const;

export const paymentEscrowAbi = [
  ...parseAbi([
    escrowLock,
    'function release(address reactive_, bytes32 orderId_, address recipient_, uint256 amount_, uint64 nonce_)',
    'function refund(address reactive_, bytes32 orderId_, uint64 nonce_)',
    ...escrowEvents,
  ]),
  paymentLegGetter,
] as const;

export const assetEscrowAbi = [
  ...parseAbi([
    escrowLock,
    'function release(address reactive_, bytes32 orderId_, address seller_, address recipient_, uint256 amount_, uint64 nonce_)',
    'function refund(address reactive_, bytes32 orderId_, address seller_, uint64 nonce_)',
    'function sellersOf(bytes32 orderId_) view returns (address[] sellers_)',
    ...escrowEvents,
  ]),
  assetLegGetter,
] as const;

/**
 * Proxy-injected callback payloads from BOTH escrows. The first argument is the
 * reactive address injected by the callback proxy; callers pass address(0).
 */
export const callbackPayloadAbi = parseAbi([
  'function release(address reactive_, bytes32 orderId_, address recipient_, uint256 amount_, uint64 nonce_)',
  'function release(address reactive_, bytes32 orderId_, address seller_, address recipient_, uint256 amount_, uint64 nonce_)',
  'function refund(address reactive_, bytes32 orderId_, uint64 nonce_)',
  'function refund(address reactive_, bytes32 orderId_, address seller_, uint64 nonce_)',
]);

/** System contract + callback proxy surface (SYSTEM/proxy share debt and depositTo). */
export const systemAbi = parseAbi([
  'function depositTo(address contract_) payable',
  'function debt(address contract_) view returns (uint256)',
  'function reserves(address contract_) view returns (uint256)',
  'function subscribe(uint256 chainId_, address contract_, uint256 topic0_, uint256 topic1_, uint256 topic2_, uint256 topic3_)',
  'function unsubscribe(uint256 chainId_, address contract_, uint256 topic0_, uint256 topic1_, uint256 topic2_, uint256 topic3_)',
  'event CallbackRequest(uint256 indexed chainId_, address indexed contract_, address indexed subscriber_, uint8 version_, bytes config_)',
  'event Subscribe(address indexed subscriber, uint256 indexed chainId, address indexed contract, uint256 topic0, uint256 topic1, uint256 topic2, uint256 topic3)',
  'event Unsubscribe(address indexed subscriber, uint256 indexed chainId, address indexed contract, uint256 topic0, uint256 topic1, uint256 topic2, uint256 topic3)',
]);

export const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

/** Event items needed for typed `getLogs` filters. */
export const paymentLockedEvent = parseAbiItem(
  'event PaymentLocked(bytes32 indexed orderId, address indexed depositor, address indexed counterparty, address token, uint256 amount, bytes32 termsHash, uint256 deadline)',
);
export const assetLockedEvent = parseAbiItem(
  'event AssetLocked(bytes32 indexed orderId, address indexed depositor, address indexed counterparty, address token, uint256 amount, bytes32 termsHash, uint256 deadline)',
);
export const paymentReleasedEvent = parseAbiItem(
  'event PaymentReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce)',
);
export const assetReleasedEvent = parseAbiItem(
  'event AssetReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce)',
);
export const paymentRefundedEvent = parseAbiItem(
  'event PaymentRefunded(bytes32 indexed orderId, address indexed depositor, uint256 amount, uint64 nonce)',
);
export const assetRefundedEvent = parseAbiItem(
  'event AssetRefunded(bytes32 indexed orderId, address indexed depositor, uint256 amount, uint64 nonce)',
);
export const orderStateChangedEvent = parseAbiItem(
  'event OrderStateChanged(bytes32 indexed orderId, string stage, uint64 nonce)',
);
export const venueRegisteredEvent = parseAbiItem(
  'event VenueRegistered(uint256 indexed chainId, address paymentEscrow, address assetEscrow)',
);
export const callbackRequestEvent = parseAbiItem(
  'event CallbackRequest(uint256 indexed chainId_, address indexed contract_, address indexed subscriber_, uint8 version_, bytes config_)',
);
export const subscribeEvent = parseAbiItem(
  'event Subscribe(address indexed subscriber, uint256 indexed chainId, address indexed contract, uint256 topic0, uint256 topic1, uint256 topic2, uint256 topic3)',
);
export const unsubscribeEvent = parseAbiItem(
  'event Unsubscribe(address indexed subscriber, uint256 indexed chainId, address indexed contract, uint256 topic0, uint256 topic1, uint256 topic2, uint256 topic3)',
);

/** CallbackConfiguration_V_1_0 from reactive-lib-omni's ISystemContract. */
export const callbackConfigAbi = [
  {
    type: 'tuple',
    components: [
      { name: 'chainId', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'gasLimit', type: 'uint64' },
      { name: 'payload', type: 'bytes' },
    ],
  },
] as const satisfies readonly AbiParameter[];
