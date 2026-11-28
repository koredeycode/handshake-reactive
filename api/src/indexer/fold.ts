import { ZERO_ADDRESS } from '../contracts.js';
import { refundReasonSchema, type OutboxDraft, type NotificationKind, type RefundReason } from '../lib/events.js';
import type { DecodedEvent } from './decode.js';
import { sseNameFor } from './decode.js';

// Kept as a re-export so existing indexer consumers keep importing it here;
// the enum itself now has a single definition shared with the SSE schemas.
export type { RefundReason } from '../lib/events.js';

export type FoldLeg = {
  role: 'payment' | 'asset';
  seller: string;
  token: string;
  amount: string;
  counterparty: string;
  chainId: number;
  txHash: string;
  state: 'locked' | 'released' | 'refunded';
  nonce: number;
};

export type FoldOrderState = {
  orderId: string;
  termsHash?: string;
  buyer?: string;
  seller?: string;
  paymentChainId?: number;
  assetChainId?: number;
  paymentToken?: string;
  paymentAmount?: string;
  assetToken?: string;
  assetAmount?: string;
  deadline?: string;
  stage?: string;
  status: string;
  settleRequested: boolean;
  refundRequested: boolean;
  paymentSeen: boolean;
  assetSeen: boolean;
  paymentClosed: boolean;
  assetClosed: boolean;
  winner?: string;
  assetLockCount: number;
  nonce: number;
  paymentRequestNonce: number;
  assetRequestNonce: number;
  protocolViolation?: string;
  refundReason?: RefundReason;
  settledAt?: string;
  refundedAt?: string;
  releaseTxHashes: { payment?: string; asset?: string };
  refundTxHashes: string[];
  legs: FoldLeg[];
};

export type NotificationDraft = {
  wallet: string;
  orderId: string;
  kind: NotificationKind;
  title: string;
  body: string;
};

export type FoldResult = {
  state: FoldOrderState;
  drafts: OutboxDraft[];
  notifications: NotificationDraft[];
  /** Set when a refund follows settleRequested — a protocol violation. */
  violation?: string;
  changed: boolean;
};

export function emptyOrderState(orderId: string): FoldOrderState {
  return {
    orderId,
    status: 'open',
    settleRequested: false,
    refundRequested: false,
    paymentSeen: false,
    assetSeen: false,
    paymentClosed: false,
    assetClosed: false,
    assetLockCount: 0,
    nonce: 0,
    paymentRequestNonce: 0,
    assetRequestNonce: 0,
    releaseTxHashes: {},
    refundTxHashes: [],
    legs: [],
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function walletsFor(state: FoldOrderState, extra: Array<string | undefined> = []): string[] {
  const parties = [state.buyer, state.seller, state.winner, ...extra]
    .filter((value): value is string => Boolean(value && value.toLowerCase() !== ZERO_ADDRESS.toLowerCase()));
  return [...new Set(parties.map((value) => value.toLowerCase()))];
}

function addBalance(
  drafts: OutboxDraft[],
  wallet: string | undefined,
  token: string | undefined,
  chainId: number | undefined,
  reason: 'lock' | 'release' | 'refund' | 'transfer',
  txHash: string,
): void {
  if (!wallet || wallet.toLowerCase() === ZERO_ADDRESS.toLowerCase() || !token || !chainId) return;
  drafts.push({
    type: 'wallet.balance',
    orderId: undefined,
    wallets: [wallet.toLowerCase()],
    payload: {
      wallet: wallet.toLowerCase(),
      chainId,
      token,
      // Refetch hint only; authoritative balance comes from /wallet/:a/balances.
      newBalance: '0',
      reason,
      txHash,
      refetch: true,
    },
  });
}

function notify(
  notifications: NotificationDraft[],
  wallet: string | undefined,
  orderId: string,
  kind: NotificationKind,
  title: string,
  body: string,
): void {
  if (!wallet || wallet.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return;
  notifications.push({ wallet: wallet.toLowerCase(), kind, title, body, orderId });
}

function deriveStatus(state: FoldOrderState): string {
  if (state.status === 'settled' || state.status === 'refunded' || state.status === 'cancelled') return state.status;
  const allClosed = allLegsClosed(state);
  if (allClosed && state.settleRequested) return 'settled';
  // Only an order-level refund decision makes the order refunding/refunded.
  // A leg-level reason such as race_loser must never do that: a winner may
  // still settle the order. This matches the UI's refundRequested derivation.
  if (allClosed && state.refundRequested) return 'refunded';
  if (state.settleRequested) return 'settling';
  if (state.refundRequested) return 'refunding';
  if (state.paymentSeen && state.assetSeen) return 'bothLocked';
  if (state.paymentSeen || state.assetSeen) return 'awaitingLock';
  return 'open';
}

/**
 * The two origin-chain closure flags are authoritative, exactly as in the
 * client's status derivation. Counting leg rows here made the API report
 * `settling` forever when a lock was indexed before its order row and only one
 * leg was ever persisted, while the UI already showed `Settled`. Do not require
 * `legs.length >= 2`: a real settlement with a missing leg row is still closed.
 */
function allLegsClosed(state: FoldOrderState): boolean {
  return state.paymentClosed && state.assetClosed;
}

function parseRefundReason(value: string | null | undefined): RefundReason | undefined {
  const parsed = refundReasonSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Pure fold of one decoded log into order state. Mirrors HandshakeReactive's
 * state machine: settleRequested dominates refund, asset legs are keyed by
 * seller (race mode) and terminal states are derived from closed legs.
 *
 * No I/O: the caller persists the returned state, drafts and notifications in
 * one Drizzle transaction.
 */
export function foldEvent(previous: FoldOrderState, event: DecodedEvent, at = new Date()): FoldResult {
  const state: FoldOrderState = {
    ...previous,
    legs: previous.legs.map((leg) => ({ ...leg })),
    releaseTxHashes: { ...previous.releaseTxHashes },
    refundTxHashes: [...previous.refundTxHashes],
  };
  const drafts: OutboxDraft[] = [];
  const notifications: NotificationDraft[] = [];
  const iso = at.toISOString();
  const name = sseNameFor(event);
  const orderId = event.orderId ?? previous.orderId;
  if (!orderId) return { state, drafts, notifications, changed: false };
  const fields = event.fields;

  switch (name) {
    case 'order.state': {
      const stage = text(fields.stage) ?? 'UNKNOWN';
      const nonce = num(fields.nonce);
      // A replayed older stage is an audit record, never a state regression.
      if (nonce >= state.nonce) {
        state.nonce = nonce;
        state.stage = stage;
        switch (stage) {
          case 'CREATED':
            state.status = 'open';
            break;
          case 'CANCELLED':
            state.status = 'cancelled';
            // Cancellation is a real order-level refund decision.
            if (!state.settleRequested) state.refundRequested = true;
            state.refundReason = 'cancelled';
            break;
          case 'PAYMENT_SEEN':
            state.paymentSeen = true;
            break;
          case 'ASSET_SEEN':
            state.assetSeen = true;
            break;
          case 'WINNER':
            // The winning seller address is learned from the asset terminal
            // event. WINNER is the normal winning path, not a race loser: only
            // RACE_LOSER_REFUND establishes that reason.
            break;
          case 'SETTLE_REQUESTED':
            // Terminal refund/cancel must never flip to settleRequested: the DB
            // CHECK constraint forbids that combination. When the settle
            // decision does apply it supersedes any earlier refund reason,
            // otherwise a stale reason keeps the order labelled as refunding.
            if (state.status !== 'refunded' && state.status !== 'cancelled') {
              state.settleRequested = true;
              state.refundReason = undefined;
            }
            break;
          case 'REFUND_REQUESTED':
            if (!state.settleRequested) state.refundRequested = true;
            break;
          case 'LATE_REFUND':
            if (!state.settleRequested) {
              state.refundRequested = true;
              state.refundReason = 'late';
            }
            break;
          case 'RACE_LOSER_REFUND':
            // Leg-level: the losing seller's asset is returned, but the order
            // itself may still settle with the winner. No refund decision flag.
            if (!state.settleRequested) state.refundReason = 'race_loser';
            break;
          case 'EXPIRED':
            if (!state.settleRequested) {
              state.refundRequested = true;
              state.refundReason = 'expired';
            }
            break;
          case 'INVALID':
            if (!state.settleRequested) {
              state.refundRequested = true;
              state.refundReason = 'invalid';
            }
            break;
          case 'PAYMENT_CLOSED':
            state.paymentClosed = true;
            break;
          case 'ASSET_CLOSED':
            state.assetClosed = true;
            break;
          default:
            break;
        }
        state.status = deriveStatus(state);
      }
      // Build the SSE draft AFTER the stage switch: a decision stage publishes
      // the reason it just established, not the previous state's reason.
      drafts.push({
        type: 'order.state',
        orderId,
        wallets: walletsFor(state),
        payload: {
          orderId,
          stage,
          nonce,
          refundReason: state.refundReason,
          txHash: event.txHash,
          blockNumber: event.blockNumber,
        },
      });
      break;
    }

    case 'lock.payment': {
      const depositor = text(fields.depositor);
      const counterparty = text(fields.counterparty);
      const chainId = event.chainId;
      state.buyer = depositor ?? state.buyer;
      state.seller = counterparty && counterparty.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
        ? counterparty
        : state.seller;
      state.paymentToken = text(fields.token) ?? state.paymentToken;
      state.paymentAmount = text(fields.amount) ?? state.paymentAmount;
      state.termsHash = text(fields.termsHash) ?? state.termsHash;
      state.deadline = text(fields.deadline) ?? state.deadline;
      state.paymentChainId = chainId;
      state.paymentSeen = true;
      upsertLeg(state, {
        role: 'payment', seller: ZERO_ADDRESS, token: text(fields.token) ?? '',
        amount: text(fields.amount) ?? '0', counterparty: counterparty ?? ZERO_ADDRESS,
        chainId, txHash: event.txHash, state: 'locked', nonce: 0,
      });
      state.status = deriveStatus(state);
      drafts.push({
        type: 'lock.payment', orderId, wallets: walletsFor(state, [depositor, counterparty]),
        payload: {
          orderId, depositor, counterparty, token: fields.token, amount: fields.amount,
          termsHash: fields.termsHash, deadline: fields.deadline, chainId, txHash: event.txHash,
        },
      });
      addBalance(drafts, depositor, text(fields.token), chainId, 'lock', event.txHash);
      notify(notifications, counterparty, orderId, 'counterparty_locked',
        'Payment locked', 'The buyer has locked payment. Your turn to lock the asset.');
      break;
    }

    case 'lock.asset': {
      const seller = text(fields.depositor);
      const counterparty = text(fields.counterparty);
      const chainId = event.chainId;
      state.seller = seller ?? state.seller;
      state.assetToken = text(fields.token) ?? state.assetToken;
      state.assetAmount = text(fields.amount) ?? state.assetAmount;
      state.termsHash = text(fields.termsHash) ?? state.termsHash;
      state.deadline = text(fields.deadline) ?? state.deadline;
      state.assetChainId = chainId;
      state.assetSeen = true;
      if (seller && !state.legs.some((leg) => leg.role === 'asset' && leg.seller.toLowerCase() === seller.toLowerCase())) {
        state.assetLockCount += 1;
      }
      upsertLeg(state, {
        role: 'asset', seller: seller ?? ZERO_ADDRESS, token: text(fields.token) ?? '',
        amount: text(fields.amount) ?? '0', counterparty: counterparty ?? state.buyer ?? ZERO_ADDRESS,
        chainId, txHash: event.txHash, state: 'locked', nonce: 0,
      });
      state.status = deriveStatus(state);
      drafts.push({
        type: 'lock.asset', orderId, wallets: walletsFor(state, [seller, counterparty, state.buyer]),
        payload: {
          orderId, seller, counterparty, token: fields.token, amount: fields.amount,
          termsHash: fields.termsHash, deadline: fields.deadline, chainId, txHash: event.txHash,
        },
      });
      addBalance(drafts, seller, text(fields.token), chainId, 'lock', event.txHash);
      notify(notifications, counterparty ?? state.buyer, orderId, 'counterparty_locked',
        'Asset locked', 'The seller has locked the asset. Settlement is starting.');
      break;
    }

    case 'callback.requested': {
      const functionName = text(fields.functionName) ?? 'unknown';
      const callbackChainId = num(fields.chainId) || event.chainId;
      const payloadArgs: unknown[] = Array.isArray(fields.args) ? fields.args : [];
      if (!state.settleRequested && state.status !== 'refunded' && state.status !== 'cancelled') {
        state.settleRequested = true;
        if (functionName.startsWith('release')) {
          if (payloadArgs.length >= 6) state.assetRequestNonce = num(payloadArgs[5]);
          else state.paymentRequestNonce = num(payloadArgs[4]);
        } else if (payloadArgs.length >= 4) {
          state.assetRequestNonce = num(payloadArgs[3]);
        } else {
          state.paymentRequestNonce = num(payloadArgs[2]);
        }
      }
      state.status = deriveStatus(state);
      drafts.push({
        type: 'callback.requested', orderId, wallets: walletsFor(state),
        payload: {
          orderId, chainId: callbackChainId, recipient: fields.recipient,
          gasLimit: fields.gasLimit, functionName, args: fields.args ?? [], txHash: event.txHash,
        },
      });
      break;
    }

    case 'terminal.release': {
      const role = fields.role === 'asset' ? 'asset' : 'payment';
      const seller = text(fields.seller);
      const recipient = text(fields.recipient);
      const nonce = num(fields.nonce);
      const requestNonce = role === 'payment' ? state.paymentRequestNonce : state.assetRequestNonce;
      const staleNonce = requestNonce > 0 && nonce !== requestNonce;
      const leg = role === 'payment'
        ? state.legs.find((item) => item.role === 'payment')
        : state.legs.find((item) => item.role === 'asset' && (!seller || item.seller.toLowerCase() === seller.toLowerCase()));
      if (!staleNonce && leg) {
        leg.state = 'released';
        leg.nonce = nonce;
      }
      if (role === 'payment') {
        state.paymentClosed = state.paymentClosed || !staleNonce;
        state.releaseTxHashes.payment = event.txHash;
      } else {
        state.assetClosed = state.assetClosed || !staleNonce;
        state.releaseTxHashes.asset = event.txHash;
        if (seller) state.winner = seller;
      }
      state.status = deriveStatus(state);
      if (state.status === 'settled' && !state.settledAt) state.settledAt = iso;
      drafts.push({
        type: 'terminal.release', orderId, wallets: walletsFor(state, [recipient, seller]),
        payload: {
          orderId, leg: role, seller, recipient, amount: fields.amount, nonce,
          chainId: event.chainId, txHash: event.txHash, staleNonce,
        },
      });
      addBalance(drafts, recipient ?? leg?.counterparty, leg?.token, event.chainId, 'release', event.txHash);
      if (state.status === 'settled' && !previous.settledAt) {
        drafts.push({
          type: 'order.settled', orderId, wallets: walletsFor(state),
          payload: {
            orderId, settledAt: state.settledAt ?? iso,
            releaseTxHashes: { payment: state.releaseTxHashes.payment, asset: state.releaseTxHashes.asset },
          },
        });
        notify(notifications, state.buyer, orderId, 'settled', 'Order settled', 'Both legs settled successfully.');
        notify(notifications, state.winner ?? state.seller, orderId, 'settled', 'Order settled', 'Both legs settled successfully.');
      }
      break;
    }

    case 'terminal.refund': {
      const role = fields.role === 'asset' ? 'asset' : 'payment';
      const seller = text(fields.seller);
      const depositor = text(fields.depositor);
      if (state.settleRequested) {
        // settleRequested is terminal: never apply a refund on top of it.
        const violation = `refund after SETTLE_REQUESTED (${event.txHash}:${event.logIndex})`;
        state.protocolViolation = state.protocolViolation ?? violation;
        drafts.push({
          type: 'terminal.refund', orderId, wallets: walletsFor(state, [depositor, seller]),
          payload: {
            orderId, leg: role, seller, depositor, amount: fields.amount, nonce: num(fields.nonce),
            chainId: event.chainId, txHash: event.txHash, protocolViolation: true,
          },
        });
        return { state, drafts, notifications, violation, changed: true };
      }
      const leg = role === 'payment'
        ? state.legs.find((item) => item.role === 'payment')
        : state.legs.find((item) => item.role === 'asset' && (!seller || item.seller.toLowerCase() === seller.toLowerCase()));
      if (leg) {
        leg.state = 'refunded';
        leg.nonce = num(fields.nonce);
      }
      state.refundTxHashes.push(event.txHash);
      // Last-resort fallback only: ?? never replaces a real stage reason
      // (late/race_loser/cancelled/...) with the generic 'expired'.
      state.refundReason = state.refundReason ?? 'expired';
      state.status = deriveStatus(state);
      if (state.status === 'refunded' && !state.refundedAt) state.refundedAt = iso;
      drafts.push({
        type: 'terminal.refund', orderId, wallets: walletsFor(state, [depositor, seller]),
        payload: {
          orderId, leg: role, seller, depositor, amount: fields.amount, nonce: num(fields.nonce),
          chainId: event.chainId, txHash: event.txHash,
        },
      });
      addBalance(drafts, depositor ?? leg?.counterparty, leg?.token, event.chainId, 'refund', event.txHash);
      if (state.status === 'refunded' && !previous.refundedAt) {
        drafts.push({
          type: 'order.refunded', orderId, wallets: walletsFor(state),
          payload: {
            orderId, reason: state.refundReason, refundedAt: state.refundedAt ?? iso,
            refundTxHashes: state.refundTxHashes,
          },
        });
        notify(notifications, state.buyer, orderId, 'refunded', 'Order refunded', 'The order was refunded on-chain.');
        notify(notifications, state.seller, orderId, 'refunded', 'Order refunded', 'The order was refunded on-chain.');
      }
      break;
    }

    default:
      // Cron100, venue registry and unknown topics are handled outside the fold.
      return { state, drafts, notifications, changed: false };
  }

  return { state, drafts, notifications, changed: true };
}

function upsertLeg(state: FoldOrderState, leg: FoldLeg): void {
  const key = `${leg.role}:${leg.seller.toLowerCase()}`;
  const index = state.legs.findIndex((item) => `${item.role}:${item.seller.toLowerCase()}` === key);
  if (index === -1) state.legs.push(leg);
  else state.legs[index] = { ...state.legs[index]!, ...leg };
}

/** Maps a persisted order row (numeric columns are strings) into fold state. */
export function stateFromRow(row: {
  orderId: string; termsHash: string | null; buyer: string | null; seller: string | null;
  paymentChainId: number | null; assetChainId: number | null;
  paymentToken: string | null; paymentAmount: string | null; assetToken: string | null;
  assetAmount: string | null; deadline: string | null; status: string;
  settleRequested: boolean; refundRequested: boolean; paymentSeen: boolean; assetSeen: boolean;
  paymentClosed: boolean; assetClosed: boolean; winner: string | null; assetLockCount: number;
  nonce: number; paymentRequestNonce: number; assetRequestNonce: number;
  protocolViolation: string | null;
  refundReason?: string | null;
}, legs: Array<{
  role: string; seller: string; token: string; amount: string; counterparty: string | null;
  chainId: number; txHash: string; state: string; nonce: number;
}>): FoldOrderState {
  const state = emptyOrderState(row.orderId);
  Object.assign(state, {
    termsHash: row.termsHash ?? undefined,
    buyer: row.buyer ?? undefined,
    seller: row.seller ?? undefined,
    paymentChainId: row.paymentChainId ?? undefined,
    assetChainId: row.assetChainId ?? undefined,
    paymentToken: row.paymentToken ?? undefined,
    paymentAmount: row.paymentAmount ?? undefined,
    assetToken: row.assetToken ?? undefined,
    assetAmount: row.assetAmount ?? undefined,
    deadline: row.deadline ?? undefined,
    status: row.status,
    settleRequested: row.settleRequested,
    refundRequested: row.refundRequested,
    paymentSeen: row.paymentSeen,
    assetSeen: row.assetSeen,
    paymentClosed: row.paymentClosed,
    assetClosed: row.assetClosed,
    winner: row.winner ?? undefined,
    assetLockCount: row.assetLockCount,
    nonce: row.nonce,
    paymentRequestNonce: row.paymentRequestNonce,
    assetRequestNonce: row.assetRequestNonce,
    protocolViolation: row.protocolViolation ?? undefined,
    // Historical rows have a blank reason until replay. The persisted reason
    // always wins: the fallback is only for legacy refunded rows with no
    // stored reason and must never overwrite a true stage reason with 'expired'.
    refundReason: parseRefundReason(row.refundReason)
      ?? (row.status === 'refunded' ? 'expired' : undefined),
    // Timestamp columns are order-level; terminal timestamps are carried in the
    // corresponding outbox payloads, not duplicated on the orders row.
    settledAt: undefined,
  });
  state.legs = legs.map((leg) => ({
    role: leg.role === 'asset' ? 'asset' : 'payment',
    seller: leg.seller, token: leg.token, amount: leg.amount,
    counterparty: leg.counterparty ?? ZERO_ADDRESS, chainId: leg.chainId,
    txHash: leg.txHash, state: leg.state as FoldLeg['state'], nonce: leg.nonce,
  }));
  return state;
}
