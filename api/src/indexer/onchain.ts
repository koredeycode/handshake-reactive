import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import { env } from '../config.js';
import { REACTIVE_CONTRACT, ZERO_ADDRESS } from '../contracts.js';
import { log } from '../lib/log.js';
import type { FoldOrderState } from './fold.js';

/**
 * Full Option B Order tuple. Built as a JSON ABI (not human-readable) because
 * the nested Venue tuple does not decode reliably from a parseAbi signature.
 */
export const reactiveOrderAbi = [
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
          {
            name: 'venue',
            type: 'tuple',
            components: [
              { name: 'paymentChainId', type: 'uint256' },
              { name: 'paymentEscrow', type: 'address' },
              { name: 'assetChainId', type: 'uint256' },
              { name: 'assetEscrow', type: 'address' },
            ],
          },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'termsHash',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

type OnchainOrder = {
  buyer: Address;
  seller: Address;
  paymentToken: Address;
  paymentAmount: bigint;
  assetToken: Address;
  assetAmount: bigint;
  deadline: bigint;
  paymentSeen: boolean;
  assetSeen: boolean;
  settleRequested: boolean;
  refundRequested: boolean;
  paymentClosed: boolean;
  assetClosed: boolean;
  paymentRefundRequested: boolean;
  assetRefundRequested: boolean;
  invalid: boolean;
  nonce: bigint;
  lastActionTimestamp: bigint;
  winner: Address;
  assetLockCount: bigint;
  paymentRequestNonce: bigint;
  assetRequestNonce: bigint;
  venue: {
    paymentChainId: bigint;
    paymentEscrow: Address;
    assetChainId: bigint;
    assetEscrow: Address;
  };
};

/** Fields we are willing to seed into fold state from the RC snapshot. */
export type HydratedTerms = Partial<FoldOrderState>;

const client = createPublicClient({ transport: http(env.REACTIVE_RPC) });
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;

/** Cache successful snapshots; retry failures only after a short cooldown. */
const hydrated = new Map<string, HydratedTerms>();
const attempts = new Map<string, { at: number; success: boolean }>();
const inFlight = new Map<string, Promise<HydratedTerms | undefined>>();
const RETRY_MS = 60_000;

function localTermsHash(order: OnchainOrder): Hex {
  // Mirrors HandshakeReactive.termsHash: keccak256(abi.encode(...11 fields)).
  return keccak256(encodeAbiParameters(
    [
      { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' },
      { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' },
      { type: 'address' }, { type: 'uint256' }, { type: 'address' },
    ],
    [
      order.buyer, order.seller, order.paymentToken, order.paymentAmount,
      order.assetToken, order.assetAmount, order.deadline,
      order.venue.paymentChainId, order.venue.paymentEscrow,
      order.venue.assetChainId, order.venue.assetEscrow,
    ],
  ));
}

function isRealOrder(order: OnchainOrder): boolean {
  const zero = ZERO_ADDRESS.toLowerCase();
  return Boolean(order.buyer) && order.buyer.toLowerCase() !== zero
    && Boolean(order.paymentToken) && order.paymentToken.toLowerCase() !== zero
    && order.deadline > 0n;
}

/**
 * Read the authoritative terms for one order from the RC. Never throws: an RPC
 * failure (or an unknown/zero order) leaves the event-derived state untouched.
 */
export function hydrateOrderTerms(orderId: string): Promise<HydratedTerms | undefined> {
  const key = orderId.toLowerCase();
  const cached = hydrated.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const now = Date.now();
  const previous = attempts.get(key);
  if (previous && (previous.success || now - previous.at < RETRY_MS)) return Promise.resolve(undefined);

  const task = loadTerms(orderId, key, now);
  inFlight.set(key, task);
  void task.finally(() => inFlight.delete(key));
  return task;
}

async function loadTerms(orderId: string, key: string, now: number): Promise<HydratedTerms | undefined> {
  attempts.set(key, { at: now, success: false });
  try {
    const [raw, onchainHash] = await Promise.all([
      client.readContract({
        address: REACTIVE_CONTRACT,
        abi: reactiveOrderAbi,
        functionName: 'getOrder',
        args: [orderId as Hex],
      }),
      client.readContract({
        address: REACTIVE_CONTRACT,
        abi: reactiveOrderAbi,
        functionName: 'termsHash',
        args: [orderId as Hex],
      }).catch(() => undefined),
    ]);
    const order = raw as unknown as OnchainOrder;
    if (!order || !isRealOrder(order)) return undefined;

    const termsHash = onchainHash && onchainHash !== ZERO_HASH
      ? onchainHash
      : localTermsHash(order);
    const settleRequested = order.settleRequested;
    const winner = order.winner?.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? undefined
      : order.winner;
    const terms: HydratedTerms = {
      termsHash,
      buyer: order.buyer,
      seller: order.seller,
      paymentToken: order.paymentToken,
      paymentAmount: order.paymentAmount.toString(),
      assetToken: order.assetToken,
      assetAmount: order.assetAmount.toString(),
      deadline: order.deadline.toString(),
      paymentChainId: Number(order.venue.paymentChainId),
      assetChainId: Number(order.venue.assetChainId),
      // Escrows are hashed into termsHash; the orders table has no escrow
      // columns, so venue display keeps using the venue registry.
      paymentSeen: order.paymentSeen,
      assetSeen: order.assetSeen,
      settleRequested,
      refundRequested: settleRequested ? false : order.refundRequested,
      paymentClosed: order.paymentClosed,
      assetClosed: order.assetClosed,
      winner,
      assetLockCount: Number(order.assetLockCount),
      nonce: Number(order.nonce),
      paymentRequestNonce: Number(order.paymentRequestNonce),
      assetRequestNonce: Number(order.assetRequestNonce),
    };
    hydrated.set(key, terms);
    attempts.set(key, { at: now, success: true });
    log.info({ orderId, termsHash }, 'hydrated order terms from reactive contract');
    return terms;
  } catch (error) {
    log.warn({ err: error, orderId }, 'on-chain terms hydration failed; using event-derived state');
    return undefined;
  }
}
