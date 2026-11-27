import { appendFileSync, writeFileSync } from 'node:fs';
import {
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  webSocket,
  type Address,
  type Hex,
} from 'viem';
import { callbackConfigAbi, callbackPayloadAbi, callbackRequestEvent, paymentEscrowAbi } from './abis.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  ETHEREUM_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  deployedAddresses,
  wsUrl,
  type SupportedChainId,
} from './networks.js';

type Hop = {
  ms: number;
  txHash: Hex;
  blockNumber: bigint;
  blockTimestamp?: bigint;
  kind?: string;
};

type Observation = {
  orderId: Hex;
  locks: { payment?: Hop; asset?: Hop };
  reactive?: Hop;
  callbacks: { payment?: Hop; asset?: Hop };
  written: boolean;
};

export type LatencyRun = {
  orderId: Hex;
  scenario: 'payment-first' | 'asset-first' | 'unknown';
  observedAt: string;
  secondLock: {
    ms: number;
    txHash: Hex;
    blockNumber: bigint;
    blockTimestamp?: bigint;
  };
  reactive: {
    ms: number;
    txHash: Hex;
    blockNumber: bigint;
    blockTimestamp?: bigint;
    deltaFromSecondLockMs: number;
  };
  paymentCallback: {
    ms: number;
    txHash: Hex;
    blockNumber: bigint;
    blockTimestamp?: bigint;
    deltaFromReactiveMs: number;
    kind: string;
  };
  assetCallback: {
    ms: number;
    txHash: Hex;
    blockNumber: bigint;
    blockTimestamp?: bigint;
    deltaFromReactiveMs: number;
    kind: string;
  };
  totalMs: number;
};

const observations = new Map<string, Observation>();
const runs: LatencyRun[] = [];
const OUT = process.env.LATENCY_OUT ?? 'latency.json';
const CSV = process.env.LATENCY_CSV ?? 'latency.csv';

function observation(orderId: Hex): Observation {
  const key = orderId.toLowerCase();
  let state = observations.get(key);
  if (!state) {
    state = { orderId: key as Hex, locks: {}, callbacks: {}, written: false };
    observations.set(key, state);
  }
  return state;
}

async function timestampFor(chainId: SupportedChainId, blockNumber: bigint): Promise<bigint | undefined> {
  try {
    const block = await clients[chainId].getBlock({ blockNumber });
    return block.timestamp;
  } catch {
    return undefined;
  }
}

function toHop(ms: number, txHash: Hex, blockNumber: bigint, blockTimestamp?: bigint, kind?: string): Hop {
  return { ms, txHash, blockNumber, blockTimestamp, kind };
}

async function recordLock(leg: 'payment' | 'asset', log: {
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  args: { orderId?: Hex };
}): Promise<void> {
  const orderId = log.args.orderId;
  if (!orderId || !log.transactionHash || !log.blockNumber) return;
  const state = observation(orderId);
  if (state.locks[leg]) return;
  const ms = Date.now();
  state.locks[leg] = toHop(ms, log.transactionHash, log.blockNumber, await timestampFor(
    leg === 'payment' ? BASE_SEPOLIA_CHAIN_ID : UNICHAIN_SEPOLIA_CHAIN_ID,
    log.blockNumber,
  ));
  if (state.locks.payment && state.locks.asset) {
    logLine(`both legs observed for ${orderId} (t0 = ${ms})`);
    maybeFinalise(state);
  }
}

async function recordCallbackRequest(log: {
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  args: { config_?: Hex };
}): Promise<void> {
  const configBytes = log.args.config_;
  if (!configBytes || !log.transactionHash || !log.blockNumber) return;
  let config: { chainId: bigint; recipient: Address; gasLimit: bigint; payload: Hex };
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    config = decodeAbiParameters(callbackConfigAbi, configBytes)[0] as typeof config;
    decoded = decodeFunctionData({ abi: callbackPayloadAbi, data: config.payload });
  } catch {
    return;
  }
  const rawOrderId = decoded.args[1];
  if (typeof rawOrderId !== 'string') return;
  const state = observation(rawOrderId as Hex);
  if (state.reactive) return;
  state.reactive = toHop(
    Date.now(),
    log.transactionHash,
    log.blockNumber,
    await timestampFor(LASNA_CHAIN_ID, log.blockNumber),
    `${decoded.functionName} → ${config.chainId}`,
  );
  logLine(`callback request observed for ${state.orderId} (${decoded.functionName})`);
  maybeFinalise(state);
}

async function recordCallback(leg: 'payment' | 'asset', kind: string, log: {
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  args: { orderId?: Hex };
}): Promise<void> {
  const orderId = log.args.orderId;
  if (!orderId || !log.transactionHash || !log.blockNumber) return;
  const state = observation(orderId);
  if (state.callbacks[leg]) return;
  state.callbacks[leg] = toHop(
    Date.now(),
    log.transactionHash,
    log.blockNumber,
    await timestampFor(leg === 'payment' ? BASE_SEPOLIA_CHAIN_ID : UNICHAIN_SEPOLIA_CHAIN_ID, log.blockNumber),
    kind,
  );
  logLine(`${leg} callback observed for ${orderId}`);
  maybeFinalise(state);
}

function maybeFinalise(state: Observation): void {
  const paymentLock = state.locks.payment;
  const assetLock = state.locks.asset;
  const reactive = state.reactive;
  const paymentCallback = state.callbacks.payment;
  const assetCallback = state.callbacks.asset;
  if (!paymentLock || !assetLock || !reactive || !paymentCallback || !assetCallback || state.written) return;
  state.written = true;

  const scenario: LatencyRun['scenario'] =
    paymentLock.ms === assetLock.ms ? 'unknown' : paymentLock.ms < assetLock.ms ? 'payment-first' : 'asset-first';
  const run: LatencyRun = {
    orderId: state.orderId,
    scenario,
    observedAt: new Date().toISOString(),
    secondLock: {
      ms: Math.max(paymentLock.ms, assetLock.ms),
      txHash: (paymentLock.ms > assetLock.ms ? paymentLock : assetLock).txHash,
      blockNumber: (paymentLock.ms > assetLock.ms ? paymentLock : assetLock).blockNumber,
      blockTimestamp: (paymentLock.ms > assetLock.ms ? paymentLock : assetLock).blockTimestamp,
    },
    reactive: {
      ms: reactive.ms,
      txHash: reactive.txHash,
      blockNumber: reactive.blockNumber,
      blockTimestamp: reactive.blockTimestamp,
      deltaFromSecondLockMs: reactive.ms - Math.max(paymentLock.ms, assetLock.ms),
    },
    paymentCallback: {
      ms: paymentCallback.ms,
      txHash: paymentCallback.txHash,
      blockNumber: paymentCallback.blockNumber,
      blockTimestamp: paymentCallback.blockTimestamp,
      deltaFromReactiveMs: paymentCallback.ms - reactive.ms,
      kind: paymentCallback.kind ?? 'unknown',
    },
    assetCallback: {
      ms: assetCallback.ms,
      txHash: assetCallback.txHash,
      blockNumber: assetCallback.blockNumber,
      blockTimestamp: assetCallback.blockTimestamp,
      deltaFromReactiveMs: assetCallback.ms - reactive.ms,
      kind: assetCallback.kind ?? 'unknown',
    },
    totalMs: Math.max(paymentCallback.ms, assetCallback.ms) - Math.max(paymentLock.ms, assetLock.ms),
  };
  runs.push(run);
  writeOutputs();
  logLine(`recorded ${scenario} loop for ${state.orderId}: ${run.totalMs} ms`);
}

function writeOutputs(): void {
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        methodology:
          'Wall-clock Date.now() when WebSocket logs arrive (observer delay included). On-chain block timestamps are also recorded but have 1-second granularity.',
        runs,
      },
      null,
      2,
    )}\n`,
  );
  if (runs.length === 1) {
    writeFileSync(CSV, 'orderId,scenario,secondLockMs,reactiveMs,paymentCallbackMs,assetCallbackMs,totalMs\n');
  }
  const r = runs[runs.length - 1]!;
  appendFileSync(
    CSV,
    `${r.orderId},${r.scenario},${r.reactive.deltaFromSecondLockMs},${r.reactive.ms},${r.paymentCallback.ms},${r.assetCallback.ms},${r.totalMs}\n`,
  );
}

function logLine(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const addresses = deployedAddresses();
const clients = {
  [LASNA_CHAIN_ID]: createPublicClient({ transport: webSocket(wsUrl(LASNA_CHAIN_ID)), pollingInterval: 1000 }),
  [BASE_SEPOLIA_CHAIN_ID]: createPublicClient({ transport: webSocket(wsUrl(BASE_SEPOLIA_CHAIN_ID)), pollingInterval: 1000 }),
  [UNICHAIN_SEPOLIA_CHAIN_ID]: createPublicClient({ transport: webSocket(wsUrl(UNICHAIN_SEPOLIA_CHAIN_ID)), pollingInterval: 1000 }),
  [ETHEREUM_SEPOLIA_CHAIN_ID]: createPublicClient({ transport: webSocket(wsUrl(ETHEREUM_SEPOLIA_CHAIN_ID)), pollingInterval: 1000 }),
} as const;

const unwatchers: Array<() => void> = [];

function watch(): void {
  unwatchers.push(
    clients[BASE_SEPOLIA_CHAIN_ID].watchContractEvent({
      ...(addresses.paymentEscrow ? { address: addresses.paymentEscrow } : {}),
      abi: paymentEscrowAbi,
      eventName: 'PaymentLocked',
      onLogs: (logs) => logs.forEach((log) => void recordLock('payment', log)),
      onError: (error) => logLine(`Base WS error: ${error.message}`),
    }),
    clients[UNICHAIN_SEPOLIA_CHAIN_ID].watchContractEvent({
      ...(addresses.assetEscrow ? { address: addresses.assetEscrow } : {}),
      abi: paymentEscrowAbi,
      eventName: 'AssetLocked',
      onLogs: (logs) => logs.forEach((log) => void recordLock('asset', log)),
      onError: (error) => logLine(`Unichain WS error: ${error.message}`),
    }),
    clients[LASNA_CHAIN_ID].watchContractEvent({
      address: '0x8888888888888888888888888888888888888888',
      abi: [callbackRequestEvent],
      eventName: 'CallbackRequest',
      onLogs: (logs) => logs.forEach((log) => void recordCallbackRequest(log)),
      onError: (error) => logLine(`Lasna WS error: ${error.message}`),
    }),
    clients[BASE_SEPOLIA_CHAIN_ID].watchContractEvent({
      ...(addresses.paymentEscrow ? { address: addresses.paymentEscrow } : {}),
      abi: paymentEscrowAbi,
      eventName: 'PaymentReleased',
      onLogs: (logs) => logs.forEach((log) => void recordCallback('payment', 'PaymentReleased', log)),
    }),
    clients[BASE_SEPOLIA_CHAIN_ID].watchContractEvent({
      ...(addresses.paymentEscrow ? { address: addresses.paymentEscrow } : {}),
      abi: paymentEscrowAbi,
      eventName: 'PaymentRefunded',
      onLogs: (logs) => logs.forEach((log) => void recordCallback('payment', 'PaymentRefunded', log)),
    }),
    clients[UNICHAIN_SEPOLIA_CHAIN_ID].watchContractEvent({
      ...(addresses.assetEscrow ? { address: addresses.assetEscrow } : {}),
      abi: paymentEscrowAbi,
      eventName: 'AssetReleased',
      onLogs: (logs) => logs.forEach((log) => void recordCallback('asset', 'AssetReleased', log)),
    }),
    clients[UNICHAIN_SEPOLIA_CHAIN_ID].watchContractEvent({
      ...(addresses.assetEscrow ? { address: addresses.assetEscrow } : {}),
      abi: paymentEscrowAbi,
      eventName: 'AssetRefunded',
      onLogs: (logs) => logs.forEach((log) => void recordCallback('asset', 'AssetRefunded', log)),
    }),
  );
  logLine(`watching 3 chains via WebSocket (reactive=${addresses.reactive})`);
  logLine('waiting for second lock → CallbackRequest → both callbacks; Ctrl-C to stop');
}

function shutdown(): void {
  unwatchers.forEach((unwatch) => unwatch());
  writeOutputs();
  logLine(`wrote ${OUT} and ${CSV}`);
  process.exit(0);
}

watch();
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
