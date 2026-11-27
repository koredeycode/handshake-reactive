import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import {
  TOPICS,
  callbackConfigTuple,
  callbackPayloadAbi,
  eventAbis,
  escrowRole,
} from '../contracts.js';

/** Minimal shape shared by viem WS logs and raw eth_getLogs results. */
export type RawLog = {
  address: string;
  data: Hex;
  topics: readonly Hex[];
  blockNumber: bigint | number | string | null;
  blockHash: Hex | string | null;
  transactionHash: Hex | string | null;
  logIndex: number | string | null;
  removed?: boolean;
};

export type DecodedEvent = {
  name: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  address: string;
  removed: boolean;
  orderId?: string;
  fields: Record<string, unknown>;
};

const topicToName = new Map<string, string>(
  Object.entries(TOPICS).map(([key, value]) => [value.toLowerCase(), key]),
);

function num(value: RawLog['blockNumber'] | RawLog['logIndex']): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function arg(args: Record<string, unknown>, name: string, index: number): unknown {
  const value = args[name] ?? args[String(index)] ?? args[`arg${index}`];
  return value;
}

function asDecimal(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  return str(value) ?? '0';
}

/**
 * Decodes one raw log into a stable, JSON-serialisable event. Returns null for
 * topics we intentionally do not index (e.g. Subscribe/Unsubscribe audit logs).
 */
export function decodeRawLog(raw: RawLog, chainId: number): DecodedEvent | null {
  const topic0 = str(raw.topics[0])?.toLowerCase();
  if (!topic0) return null;
  const name = topicToName.get(topic0);
  if (!name) return null;
  const abiEvent = eventAbis[name === 'orderStateChanged' ? 'OrderStateChanged' : eventNameFor(name)];
  if (!abiEvent) return null;

  let decoded: { eventName: string; args: unknown };
  try {
    decoded = decodeEventLog({
      abi: [abiEvent],
      data: raw.data,
      topics: raw.topics as [Hex, ...Hex[]],
      strict: false,
    });
  } catch {
    return null;
  }
  const args = (decoded.args ?? {}) as Record<string, unknown>;
  let fields: Record<string, unknown> = {};
  let orderId: string | undefined;

  switch (name) {
    case 'paymentLocked':
    case 'assetLocked': {
      orderId = str(arg(args, 'orderId', 0));
      fields = {
        orderId,
        depositor: str(arg(args, 'depositor', 1)),
        counterparty: str(arg(args, 'counterparty', 2)),
        token: str(arg(args, 'token', 3)),
        amount: asDecimal(arg(args, 'amount', 4)),
        termsHash: str(arg(args, 'termsHash', 5)),
        deadline: asDecimal(arg(args, 'deadline', 6)),
        role: escrowRole(chainId, str(raw.address) ?? ''),
      };
      break;
    }
    case 'paymentReleased':
    case 'assetReleased': {
      orderId = str(arg(args, 'orderId', 0));
      fields = {
        orderId,
        recipient: str(arg(args, 'recipient', 1)),
        amount: asDecimal(arg(args, 'amount', 2)),
        nonce: Number(asDecimal(arg(args, 'nonce', 3))),
        role: escrowRole(chainId, str(raw.address) ?? ''),
      };
      break;
    }
    case 'paymentRefunded':
    case 'assetRefunded': {
      orderId = str(arg(args, 'orderId', 0));
      fields = {
        orderId,
        depositor: str(arg(args, 'depositor', 1)),
        amount: asDecimal(arg(args, 'amount', 2)),
        nonce: Number(asDecimal(arg(args, 'nonce', 3))),
        role: escrowRole(chainId, str(raw.address) ?? ''),
      };
      break;
    }
    case 'orderStateChanged': {
      orderId = str(arg(args, 'orderId', 0));
      fields = {
        orderId,
        stage: str(arg(args, 'stage', 1)),
        nonce: Number(asDecimal(arg(args, 'nonce', 2))),
      };
      break;
    }
    case 'callbackRequest': {
      // CallbackRequest(uint256,address,address,uint8,bytes): the subscriber is
      // topic3. Prefer the decoded name, but fall back to the raw topic so a
      // future ABI/payload change cannot hide who requested the callback.
      const topicSubscriber = str(raw.topics[3]);
      const subscriber = str(arg(args, 'subscriber_', 2))
        ?? (topicSubscriber ? `0x${topicSubscriber.slice(-40)}`.toLowerCase() : undefined);
      const configBytes = str(arg(args, 'config_', 4));
      let config: { chainId: bigint; recipient: Address; gasLimit: bigint; payload: Hex } | undefined;
      let functionName = 'unknown';
      let payloadArgs: string[] = [];
      if (configBytes) {
        try {
          const decodedConfig = decodeAbiParameters(callbackConfigTuple, configBytes as Hex)[0] as NonNullable<typeof config>;
          config = decodedConfig;
          const decodedPayload = decodeFunctionData({ abi: callbackPayloadAbi, data: decodedConfig.payload });
          functionName = decodedPayload.functionName;
          payloadArgs = decodedPayload.args.map((value) =>
            typeof value === 'bigint' ? value.toString() : String(value),
          );
          orderId = str(payloadArgs[1]);
        } catch {
          // Still record the callback hop even if a future payload shape changes.
        }
      }
      fields = {
        orderId,
        chainId: config ? Number(config.chainId) : Number(asDecimal(arg(args, 'chainId_', 0))),
        contract: str(arg(args, 'contract_', 1)),
        subscriber,
        version: Number(asDecimal(arg(args, 'version_', 3))),
        recipient: config?.recipient,
        gasLimit: config ? Number(config.gasLimit) : undefined,
        functionName,
        args: payloadArgs,
      };
      break;
    }
    case 'cron10': {
      fields = { number: asDecimal(arg(args, 'number', 0)) };
      break;
    }
    case 'transfer': {
      fields = {
        from: str(arg(args, 'from', 0)),
        to: str(arg(args, 'to', 1)),
        value: asDecimal(arg(args, 'value', 2)),
        token: str(raw.address),
      };
      break;
    }
    case 'venueRegistered':
    case 'venueUnregistered': {
      fields = {
        venueChainId: Number(asDecimal(arg(args, 'chainId', 0))),
        paymentEscrow: str(arg(args, 'paymentEscrow', 1)),
        assetEscrow: str(arg(args, 'assetEscrow', 2)),
      };
      break;
    }
    default:
      fields = { args: Object.fromEntries(Object.entries(args).map(([key, value]) => [key, String(value)])) };
  }

  return {
    name,
    chainId,
    txHash: str(raw.transactionHash) ?? `0x${'0'.repeat(64)}`,
    logIndex: num(raw.logIndex),
    blockNumber: num(raw.blockNumber),
    blockHash: str(raw.blockHash) ?? `0x${'0'.repeat(64)}`,
    address: str(raw.address) ?? '',
    removed: Boolean(raw.removed),
    orderId,
    fields,
  };
}

function eventNameFor(key: string): string {
  switch (key) {
    case 'paymentLocked': return 'PaymentLocked';
    case 'assetLocked': return 'AssetLocked';
    case 'paymentReleased': return 'PaymentReleased';
    case 'paymentRefunded': return 'PaymentRefunded';
    case 'assetReleased': return 'AssetReleased';
    case 'assetRefunded': return 'AssetRefunded';
    case 'callbackRequest': return 'CallbackRequest';
    case 'cron10': return 'Cron10';
    case 'venueRegistered': return 'VenueRegistered';
    case 'venueUnregistered': return 'VenueUnregistered';
    default: return key;
  }
}

/** SSE name for a decoded on-chain event (used by the fold). */
export function sseNameFor(event: DecodedEvent): string {
  switch (event.name) {
    case 'orderStateChanged': return 'order.state';
    case 'paymentLocked': return 'lock.payment';
    case 'assetLocked': return 'lock.asset';
    case 'callbackRequest': return 'callback.requested';
    case 'paymentReleased':
    case 'assetReleased': return 'terminal.release';
    case 'paymentRefunded':
    case 'assetRefunded': return 'terminal.refund';
    case 'cron10': return 'heartbeat';
    default: return event.name;
  }
}
