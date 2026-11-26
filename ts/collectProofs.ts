import {
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  http,
  type Address,
  type Hex,
} from 'viem';
import {
  assetLockedEvent,
  assetRefundedEvent,
  assetReleasedEvent,
  callbackConfigAbi,
  callbackRequestEvent,
  paymentEscrowAbi,
  paymentLockedEvent,
  paymentRefundedEvent,
  paymentReleasedEvent,
} from './abis.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  SYSTEM_CONTRACT,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  chainName,
  deployedAddresses,
  explorerTxLink,
  rpcUrl,
  type SupportedChainId,
} from './networks.js';

export type ProofHop = {
  key: 'paymentLock' | 'assetLock' | 'callback' | 'paymentCallback' | 'assetCallback';
  label: string;
  chainId: SupportedChainId;
  txHash: Hex;
  blockNumber: bigint;
  timestamp?: bigint;
  decoded?: string;
};

export type DecodedCallback = {
  txHash: Hex;
  chainId: SupportedChainId;
  destinationChainId: SupportedChainId;
  recipient: Address;
  gasLimit: bigint;
  functionName: 'release' | 'refund' | string;
  args: readonly unknown[];
};

export type Proof = {
  orderId: Hex;
  hops: ProofHop[];
  callbacks: DecodedCallback[];
};

/** Normalises a user-supplied order ID to a 32-byte lowercase hex string. */
export function normalizeOrderId(input: string): Hex {
  const raw = input.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{1,64}$/.test(raw)) {
    throw new Error(`Invalid order ID: ${input}`);
  }
  return `0x${raw.toLowerCase().padStart(64, '0')}` as Hex;
}

const clients = {
  [LASNA_CHAIN_ID]: createPublicClient({ chain: undefined, transport: http(rpcUrl(LASNA_CHAIN_ID)) }),
  [BASE_SEPOLIA_CHAIN_ID]: createPublicClient({ chain: undefined, transport: http(rpcUrl(BASE_SEPOLIA_CHAIN_ID)) }),
  [UNICHAIN_SEPOLIA_CHAIN_ID]: createPublicClient({ chain: undefined, transport: http(rpcUrl(UNICHAIN_SEPOLIA_CHAIN_ID)) }),
} as const;

function lookback(): bigint {
  const configured = BigInt(process.env.PROOF_LOOKBACK_BLOCKS ?? '200000');
  return configured > 0n ? configured : 0n;
}

async function range(chainId: SupportedChainId): Promise<{ fromBlock: bigint; toBlock: bigint }> {
  const toBlock = await clients[chainId].getBlockNumber();
  const window = lookback();
  return { fromBlock: window > toBlock ? 0n : toBlock - window, toBlock };
}

async function blockTimestamp(chainId: SupportedChainId, blockNumber: bigint): Promise<bigint | undefined> {
  try {
    const block = await clients[chainId].getBlock({ blockNumber });
    return block.timestamp;
  } catch {
    return undefined;
  }
}

/** Resolves origin → reactive → callback tx hashes from logs on all three chains. */
export async function collectProofs(orderIdInput: string): Promise<Proof> {
  const orderId = normalizeOrderId(orderIdInput);
  const addresses = deployedAddresses();
  const hops: ProofHop[] = [];
  const callbacks: DecodedCallback[] = [];

  const baseRange = await range(BASE_SEPOLIA_CHAIN_ID);
  const unichainRange = await range(UNICHAIN_SEPOLIA_CHAIN_ID);
  const lasnaRange = await range(LASNA_CHAIN_ID);

  const paymentLocked = await clients[BASE_SEPOLIA_CHAIN_ID].getLogs({
    ...(addresses.paymentEscrow ? { address: addresses.paymentEscrow } : {}),
    event: paymentLockedEvent,
    args: { orderId },
    ...baseRange,
  });
  for (const log of paymentLocked) {
    hops.push({
      key: 'paymentLock',
      label: 'Payment locked (origin)',
      chainId: BASE_SEPOLIA_CHAIN_ID,
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
      timestamp: await blockTimestamp(BASE_SEPOLIA_CHAIN_ID, log.blockNumber!),
      decoded: `depositor=${log.args.depositor} amount=${log.args.amount} deadline=${log.args.deadline}`,
    });
  }

  const assetLocked = await clients[UNICHAIN_SEPOLIA_CHAIN_ID].getLogs({
    ...(addresses.assetEscrow ? { address: addresses.assetEscrow } : {}),
    event: assetLockedEvent,
    args: { orderId },
    ...unichainRange,
  });
  for (const log of assetLocked) {
    hops.push({
      key: 'assetLock',
      label: 'Asset locked (second origin)',
      chainId: UNICHAIN_SEPOLIA_CHAIN_ID,
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
      timestamp: await blockTimestamp(UNICHAIN_SEPOLIA_CHAIN_ID, log.blockNumber!),
      decoded: `depositor=${log.args.depositor} amount=${log.args.amount} deadline=${log.args.deadline}`,
    });
  }

  // CallbackRequest logs do not index the order ID; decode each callback payload and match it.
  const requests = await clients[LASNA_CHAIN_ID].getLogs({
    address: SYSTEM_CONTRACT,
    event: callbackRequestEvent,
    ...(addresses.reactive ? { args: { subscriber_: addresses.reactive } } : {}),
    ...lasnaRange,
  });
  const seenCallbacks = new Set<string>();
  for (const log of requests) {
    const configBytes = log.args.config_;
    if (!configBytes) continue;
    let config: { chainId: bigint; recipient: Address; gasLimit: bigint; payload: Hex } | undefined;
    try {
      config = decodeAbiParameters(callbackConfigAbi, configBytes)[0] as {
        chainId: bigint;
        recipient: Address;
        gasLimit: bigint;
        payload: Hex;
      };
    } catch {
      continue;
    }
    let decoded: { functionName: string; args: readonly unknown[] } | undefined;
    try {
      decoded = decodeFunctionData({ abi: paymentEscrowAbi, data: config.payload });
    } catch {
      continue;
    }
    const payloadOrderId = decoded.args[1];
    if (typeof payloadOrderId !== 'string' || payloadOrderId.toLowerCase() !== orderId.toLowerCase()) continue;
    const chainId = Number(config.chainId) as SupportedChainId;
    if (chainId !== BASE_SEPOLIA_CHAIN_ID && chainId !== UNICHAIN_SEPOLIA_CHAIN_ID) continue;
    const dedupe = `${log.transactionHash}:${config.recipient}:${config.payload}`;
    if (seenCallbacks.has(dedupe)) continue;
    seenCallbacks.add(dedupe);

    hops.push({
      key: 'callback',
      label: `Callback requested → ${chainName(chainId)}`,
      chainId: LASNA_CHAIN_ID,
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
      timestamp: await blockTimestamp(LASNA_CHAIN_ID, log.blockNumber!),
      decoded: `${decoded.functionName}(${decoded.args.slice(1).join(', ')}) gasLimit=${config.gasLimit}`,
    });
    callbacks.push({
      txHash: log.transactionHash!,
      chainId: LASNA_CHAIN_ID,
      destinationChainId: chainId,
      recipient: config.recipient,
      gasLimit: config.gasLimit,
      functionName: decoded.functionName,
      args: decoded.args,
    });
  }

  const terminalEvents = [
    { event: paymentReleasedEvent, key: 'paymentCallback' as const, label: 'Payment released (callback)', chainId: BASE_SEPOLIA_CHAIN_ID, address: addresses.paymentEscrow, range: baseRange },
    { event: paymentRefundedEvent, key: 'paymentCallback' as const, label: 'Payment refunded (callback)', chainId: BASE_SEPOLIA_CHAIN_ID, address: addresses.paymentEscrow, range: baseRange },
    { event: assetReleasedEvent, key: 'assetCallback' as const, label: 'Asset released (callback)', chainId: UNICHAIN_SEPOLIA_CHAIN_ID, address: addresses.assetEscrow, range: unichainRange },
    { event: assetRefundedEvent, key: 'assetCallback' as const, label: 'Asset refunded (callback)', chainId: UNICHAIN_SEPOLIA_CHAIN_ID, address: addresses.assetEscrow, range: unichainRange },
  ] as const;

  for (const item of terminalEvents) {
    const logs = await clients[item.chainId].getLogs({
      ...(item.address ? { address: item.address } : {}),
      event: item.event,
      args: { orderId },
      ...item.range,
    });
    for (const log of logs) {
      hops.push({
        key: item.key,
        label: item.label,
        chainId: item.chainId,
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        timestamp: await blockTimestamp(item.chainId, log.blockNumber!),
        decoded: `amount=${log.args.amount} nonce=${log.args.nonce}`,
      });
    }
  }

  const rank = { paymentLock: 0, assetLock: 1, callback: 2, paymentCallback: 3, assetCallback: 4 } as const;
  hops.sort((a, b) => rank[a.key] - rank[b.key] || (a.chainId < b.chainId ? -1 : 1));
  return { orderId, hops, callbacks };
}

/** Markdown table shared by collectProofs.ts and proofBundle.ts. */
export function proofTable(proof: Proof): string {
  const header = '| Hop | Chain | Tx hash | Explorer | Block | Time (UTC) |';
  const divider = '|---|---|---|---|---:|---|';
  if (proof.hops.length === 0) {
    return `${header}\n${divider}\n| _none observed_ | — | — | — | — | — |`;
  }
  const rows = proof.hops.map(
    (hop) =>
      `| ${hop.label} | ${chainName(hop.chainId)} (${hop.chainId}) | \`${hop.txHash}\` | [explorer](${explorerTxLink(hop.chainId, hop.txHash)}) | ${hop.blockNumber} | ${
        hop.timestamp ? new Date(Number(hop.timestamp) * 1000).toISOString() : '—'
      } |`,
  );
  return [header, divider, ...rows].join('\n');
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: npm run proofs -- <orderId>');
    process.exitCode = 1;
    return;
  }
  const proof = await collectProofs(input);
  console.log(`# Handshake proof — ${proof.orderId}\n`);
  console.log(proofTable(proof));
  const systems = [
    `cast call --rpc-url $REACTIVE_RPC ${SYSTEM_CONTRACT} "debt(address)(uint256)" ${deployedAddresses().reactive}`,
    `cast call --rpc-url $REACTIVE_RPC ${SYSTEM_CONTRACT} "reserves(address)(uint256)" ${deployedAddresses().reactive}`,
  ];
  console.log(`\nHealth checks:\n${systems.map((line) => `\`\`\`bash\n${line}\n\`\`\``).join('\n')}`);
  console.log('\nAll hashes above come from on-chain logs — no fabricated data.');
}

if (process.argv[1]?.endsWith('collectProofs.ts') || process.argv[1]?.endsWith('collectProofs.js')) {
  await main();
}
