import {
  parseAbi,
  parseAbiItem,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';

/**
 * Live testnet addresses mirrored from the authoritative `deployments.json` at
 * the repository root (and `docs/MARKETS.md`). These are configuration copies,
 * not contract code; env overrides below take precedence. No contract is
 * deployed, changed or redeployed by this backend.
 */
export const DEPLOYMENTS = {
  systemContract: '0x8888888888888888888888888888888888888888',
  legacySystemContract: '0x0000000000000000000000000000000000fffFfF',
  reactive: '0x037cef4c80c7424b2c7fb45770990b5763f67474',
  callbackProxies: {
    84532: '0x476F44b11F5C942c58f4c8E3d0300E5710743585',
    1301: '0x775c9B990ADe401060B78D0e98684eEf8d2466C1',
    11155111: '0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4',
  },
  venues: {
    84532: {
      paymentEscrow: '0xebe1bd1c403158aa6a8375b7a63a87b47e8d08d0',
      assetEscrow: '0xA1493823ede37E1cE4e3c0B862FC3389e98Bf85b',
      paymentToken: '0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6',
      assetToken: '0x1B07c8fc7FE5984a68b206152cC7d3352deD0f19',
    },
    1301: {
      paymentEscrow: '0xa2ea651bd30Eb9212E5BCd272d3a9a877D6dFa38',
      assetEscrow: '0x037CeF4c80C7424b2c7Fb45770990b5763f67474',
      paymentToken: '0xbc2037b06278633968d869253f6f512562f86306',
      assetToken: '0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6',
    },
    11155111: {
      paymentEscrow: '0x5Ee944ddc392a9729d52702AB4c2e327848533a1',
      assetEscrow: '0xbC2037B06278633968D869253F6F512562F86306',
      paymentToken: '0xD894D5bAade0C06137D45C616Cb9D2e6cbFa5fD4',
      assetToken: '0x9ffd2f7795fa3c029548c9faeac8da5cdb79047d',
    },
  },
} as const;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export const SYSTEM_CONTRACT = (process.env.SYSTEM_CONTRACT ?? DEPLOYMENTS.systemContract) as Address;
export const LEGACY_SYSTEM_CONTRACT = DEPLOYMENTS.legacySystemContract as Address;
export const REACTIVE_CONTRACT = (process.env.RC_ADDRESS ?? DEPLOYMENTS.reactive) as Address;
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as Address;

/**
 * topic0 constants — `cast keccak` of the exact signatures (same as scripts/proof.sh),
 * except `cron100`, which is the fixed legacy-system-contract constant from the
 * Reactive docs (not keccak of the local signature).
 *
 * FUTURE CRON100 CUTOVER: the indexer/backend must be redeployed and verified
 * against the new RC + escrow addresses BEFORE any test transaction is sent on
 * the new deployment. Otherwise those events fall outside the backfill window
 * and show up as empty terms / empty timelines. See personal/CRON100-RUNBOOK.md.
 */
export const TOPICS = {
  orderStateChanged: '0x49ecf21afe0244f5a25b83eafd7d9c0eb898acbb8338e37040e2d0999b9ae306',
  paymentLocked: '0xeb5b40d9e18193862e588be5f3887ec6b361ac7d7ad78e42e11adbd4cd697664',
  assetLocked: '0xe158058005a726fed86812e55f6199567efd4d6208f3367a8f61078ce1c3489a',
  paymentReleased: '0x903a04873fc04f468e31890f89b42c3d9aee337eea5a0e4c35446103b17bbf65',
  paymentRefunded: '0x7ed45eda872966fe5f5f62451acdda28671441ee7b9cce8dc0483b10d95ac77c',
  assetReleased: '0x8e7c2eb1a26bfcaca6a1abcf5add7d581276e708f9f446876015ed75c55397ee',
  assetRefunded: '0x512b6121585cd55600c64960420f18d49179f8611ab38147fe12deb03931f61f',
  callbackRequest: '0xef94dbc611c4b95bf4b8ba34b413972180c2faf26fbb480befacedd83e07b133',
  cron100: '0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70',
  venueRegistered: '0xf34676cc1d86839b1e3d5f8a8757fba03bb160a73e2cc3cc9550b663bcb516c1',
  venueUnregistered: '0x57269d63436b5c61a11ca8ed151cfb2a6e1ab1d7b9d087d8ebaca7114c79c6b0',
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const satisfies Record<string, Hex>;

// Event ABIs used to decode raw logs (one subscription per chain, many topics).
export const paymentLockedEvent = parseAbiItem(
  'event PaymentLocked(bytes32 indexed orderId, address indexed depositor, address indexed counterparty, address token, uint256 amount, bytes32 termsHash, uint256 deadline)',
);
export const assetLockedEvent = parseAbiItem(
  'event AssetLocked(bytes32 indexed orderId, address indexed depositor, address indexed counterparty, address token, uint256 amount, bytes32 termsHash, uint256 deadline)',
);
export const paymentReleasedEvent = parseAbiItem(
  'event PaymentReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce)',
);
export const paymentRefundedEvent = parseAbiItem(
  'event PaymentRefunded(bytes32 indexed orderId, address indexed depositor, uint256 amount, uint64 nonce)',
);
export const assetReleasedEvent = parseAbiItem(
  'event AssetReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce)',
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
export const venueUnregisteredEvent = parseAbiItem(
  'event VenueUnregistered(uint256 indexed chainId, address paymentEscrow, address assetEscrow)',
);
export const callbackRequestEvent = parseAbiItem(
  'event CallbackRequest(uint256 indexed chainId_, address indexed contract_, address indexed subscriber_, uint8 version_, bytes config_)',
);
export const cron100Event = parseAbiItem('event Cron100(uint256)');
export const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/** `config_` is abi.encode(CallbackConfiguration_V_1_0) — a single tuple. */
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
] as const;

/** First argument is the proxy-injected reactive address; orderId is arg 2. */
export const callbackPayloadAbi = parseAbi([
  'function release(address reactive_, bytes32 orderId_, address recipient_, uint256 amount_, uint64 nonce_)',
  'function release(address reactive_, bytes32 orderId_, address seller_, address recipient_, uint256 amount_, uint64 nonce_)',
  'function refund(address reactive_, bytes32 orderId_, uint64 nonce_)',
  'function refund(address reactive_, bytes32 orderId_, address seller_, uint64 nonce_)',
]);

export const tokenMetadataAbi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const multicall3Abi = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

export const systemReadAbi = parseAbi([
  'function debt(address contract_) view returns (uint256)',
  'function reserves(address contract_) view returns (uint256)',
  'function subscriptionCount() view returns (uint256)',
]);

export const eventAbis: Record<string, AbiEvent> = Object.fromEntries(
  [
    paymentLockedEvent,
    assetLockedEvent,
    paymentReleasedEvent,
    paymentRefundedEvent,
    assetReleasedEvent,
    assetRefundedEvent,
    orderStateChangedEvent,
    venueRegisteredEvent,
    venueUnregisteredEvent,
    callbackRequestEvent,
    cron100Event,
    transferEvent,
  ].map((item) => [item.name, item]),
);

export type ChainRole = 'payment' | 'asset';

export type ChainConfig = {
  chainId: number;
  name: string;
  explorer: string;
  /** eth_getLogs block cap proven by scripts/proof.sh. */
  logChunkSize: number;
  /** Addresses included in every eth_subscribe / eth_getLogs filter. */
  addresses: Address[];
  topic0s: Hex[];
  callbackProxy?: Address;
  paymentEscrow?: Address;
  assetEscrow?: Address;
  escrows: Map<Address, ChainRole>;
};

function optAddress(value: string | undefined): Address | undefined {
  return value ? (value as Address) : undefined;
}

export const CHAIN_CONFIGS: ChainConfig[] = [
  {
    chainId: 5318007,
    name: 'Reactive Lasna',
    explorer: 'https://lasna.reactscan.net',
    logChunkSize: 30_000,
    addresses: [REACTIVE_CONTRACT, SYSTEM_CONTRACT, LEGACY_SYSTEM_CONTRACT],
    topic0s: [
      TOPICS.orderStateChanged,
      TOPICS.callbackRequest,
      TOPICS.cron100,
      TOPICS.venueRegistered,
      TOPICS.venueUnregistered,
    ],
    escrows: new Map(),
  },
  {
    chainId: 84532,
    name: 'Base Sepolia',
    explorer: 'https://sepolia.basescan.org',
    logChunkSize: 200,
    callbackProxy: DEPLOYMENTS.callbackProxies[84532],
    paymentEscrow: DEPLOYMENTS.venues[84532].paymentEscrow,
    assetEscrow: DEPLOYMENTS.venues[84532].assetEscrow,
    addresses: [DEPLOYMENTS.venues[84532].paymentEscrow, DEPLOYMENTS.venues[84532].assetEscrow],
    topic0s: [
      TOPICS.paymentLocked,
      TOPICS.assetLocked,
      TOPICS.paymentReleased,
      TOPICS.paymentRefunded,
      TOPICS.assetReleased,
      TOPICS.assetRefunded,
    ],
    escrows: new Map(
      [
        [DEPLOYMENTS.venues[84532].paymentEscrow.toLowerCase() as Address, 'payment'],
        [DEPLOYMENTS.venues[84532].assetEscrow.toLowerCase() as Address, 'asset'],
      ] as Array<[Address, ChainRole]>,
    ),
  },
  {
    chainId: 1301,
    name: 'Unichain Sepolia',
    explorer: 'https://sepolia.uniscan.xyz',
    logChunkSize: 1000,
    callbackProxy: DEPLOYMENTS.callbackProxies[1301],
    paymentEscrow: (process.env.UNICHAIN_PAYMENT_ESCROW_ADDRESS ??
      DEPLOYMENTS.venues[1301].paymentEscrow) as Address,
    assetEscrow: (process.env.UNICHAIN_ASSET_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[1301].assetEscrow) as Address,
    addresses: [
      (process.env.UNICHAIN_PAYMENT_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[1301].paymentEscrow) as Address,
      (process.env.UNICHAIN_ASSET_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[1301].assetEscrow) as Address,
    ],
    topic0s: [
      TOPICS.paymentLocked,
      TOPICS.assetLocked,
      TOPICS.paymentReleased,
      TOPICS.paymentRefunded,
      TOPICS.assetReleased,
      TOPICS.assetRefunded,
    ],
    escrows: new Map(
      [
        [(process.env.UNICHAIN_PAYMENT_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[1301].paymentEscrow).toLowerCase() as Address, 'payment'],
        [(process.env.UNICHAIN_ASSET_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[1301].assetEscrow).toLowerCase() as Address, 'asset'],
      ] as Array<[Address, ChainRole]>,
    ),
  },
  {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    explorer: 'https://sepolia.etherscan.io',
    logChunkSize: 500,
    callbackProxy: DEPLOYMENTS.callbackProxies[11155111],
    paymentEscrow: (process.env.SEPOLIA_PAYMENT_ESCROW_ADDRESS ??
      DEPLOYMENTS.venues[11155111].paymentEscrow) as Address,
    assetEscrow: (process.env.SEPOLIA_ASSET_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[11155111].assetEscrow) as Address,
    addresses: [
      (process.env.SEPOLIA_PAYMENT_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[11155111].paymentEscrow) as Address,
      (process.env.SEPOLIA_ASSET_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[11155111].assetEscrow) as Address,
    ],
    topic0s: [
      TOPICS.paymentLocked,
      TOPICS.assetLocked,
      TOPICS.paymentReleased,
      TOPICS.paymentRefunded,
      TOPICS.assetReleased,
      TOPICS.assetRefunded,
    ],
    escrows: new Map(
      [
        [(process.env.SEPOLIA_PAYMENT_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[11155111].paymentEscrow).toLowerCase() as Address, 'payment'],
        [(process.env.SEPOLIA_ASSET_ESCROW_ADDRESS ?? DEPLOYMENTS.venues[11155111].assetEscrow).toLowerCase() as Address, 'asset'],
      ] as Array<[Address, ChainRole]>,
    ),
  },
];

// Curated token Transfers are included in the same single subscription per
// chain so wallet.balance hints are emitted without a second subscription.
for (const chain of CHAIN_CONFIGS) {
  if (chain.chainId === 5318007) continue;
  const venue = DEPLOYMENTS.venues[chain.chainId as 84532 | 1301 | 11155111];
  chain.addresses.push(venue.paymentToken as Address, venue.assetToken as Address);
  if (!chain.topic0s.includes(TOPICS.transfer)) chain.topic0s.push(TOPICS.transfer);
}

export const CHAIN_BY_ID = new Map(CHAIN_CONFIGS.map((chain) => [chain.chainId, chain]));

/** Curated tokens seeded into the catalog at startup (all verified). */
export const CURATED_TOKENS = CHAIN_CONFIGS.flatMap((chain) =>
  chain.chainId === 5318007
    ? []
    : [
        {
          chainId: chain.chainId,
          address: (DEPLOYMENTS.venues[chain.chainId as 84532 | 1301 | 11155111].paymentToken) as Address,
          source: 'curated' as const,
        },
        {
          chainId: chain.chainId,
          address: (DEPLOYMENTS.venues[chain.chainId as 84532 | 1301 | 11155111].assetToken) as Address,
          source: 'curated' as const,
        },
      ],
);

export function escrowRole(chainId: number, address: string): ChainRole | undefined {
  return CHAIN_BY_ID.get(chainId)?.escrows.get(address.toLowerCase() as Address);
}

export function knownOriginChainIds(): number[] {
  return CHAIN_CONFIGS.filter((chain) => chain.callbackProxy).map((chain) => chain.chainId);
}

export function optionalAddress(value: string | undefined): Address | undefined {
  return optAddress(value);
}

export function isEventTopic(topic: Hex | undefined): topic is (typeof TOPICS)[keyof typeof TOPICS] {
  if (!topic) return false;
  return Object.values(TOPICS).some((value) => value.toLowerCase() === topic.toLowerCase());
}

export const ALL_ESCROW_ADDRESSES: Address[] = CHAIN_CONFIGS.flatMap((chain) => [...chain.escrows.keys()]);
