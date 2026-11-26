import { writeFileSync } from 'node:fs';
import { createPublicClient, formatEther, http, type Address } from 'viem';
import { reactiveAbi, systemAbi } from './abis.js';
import { collectProofs, normalizeOrderId, proofTable } from './collectProofs.js';
import {
  BASE_CALLBACK_PROXY,
  BASE_SEPOLIA_CHAIN_ID,
  CHAINS,
  LASNA_CHAIN_ID,
  SYSTEM_CONTRACT,
  UNICHAIN_CALLBACK_PROXY,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  chainName,
  deployedAddresses,
  explorerTxLink,
  rpcUrl,
  type SupportedChainId,
} from './networks.js';

type OrderView = {
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
  invalid: boolean;
  nonce: bigint;
  lastActionTimestamp: bigint;
};

async function health(chainId: SupportedChainId, payer: Address, contractAddress: Address) {
  const client = createPublicClient({ chain: CHAINS[chainId], transport: http(rpcUrl(chainId)) });
  const debt = await client.readContract({ address: payer, abi: systemAbi, functionName: 'debt', args: [contractAddress] });
  let reserves: bigint | 'unavailable' = 'unavailable';
  try {
    reserves = await client.readContract({ address: payer, abi: systemAbi, functionName: 'reserves', args: [contractAddress] });
  } catch {
    // Not all system/proxy builds expose reserves; preflight prints the same distinction.
  }
  const balance = await client.getBalance({ address: contractAddress });
  return { debt, reserves, balance: formatEther(balance) };
}

function commandBlock(commands: string[]): string {
  return commands.map((command) => `\`\`\`bash\n${command}\n\`\`\``).join('\n\n');
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: npm run proof -- <orderId>  (writes proof.md)');
    process.exitCode = 1;
    return;
  }
  const orderId = normalizeOrderId(input);
  const addresses = deployedAddresses();
  const proof = await collectProofs(orderId);

  const lasna = createPublicClient({ chain: CHAINS[LASNA_CHAIN_ID], transport: http(rpcUrl(LASNA_CHAIN_ID)) });
  let order: OrderView | undefined;
  if (addresses.reactive) {
    try {
      order = (await lasna.readContract({
        address: addresses.reactive,
        abi: reactiveAbi,
        functionName: 'getOrder',
        args: [orderId],
      })) as OrderView;
    } catch (error) {
      console.warn(`Could not read getOrder: ${(error as Error).message}`);
    }
  }

  const [rcHealth, paymentHealth, assetHealth] = await Promise.all([
    health(LASNA_CHAIN_ID, SYSTEM_CONTRACT, addresses.reactive),
    health(BASE_SEPOLIA_CHAIN_ID, BASE_CALLBACK_PROXY, addresses.paymentEscrow),
    health(UNICHAIN_SEPOLIA_CHAIN_ID, UNICHAIN_CALLBACK_PROXY, addresses.assetEscrow),
  ]);

  const healthRows: Array<{
    label: string;
    chainId: SupportedChainId;
    payer: Address;
    contractAddress: Address;
    data: Awaited<ReturnType<typeof health>>;
  }> = [
    { label: 'Reactive arbiter', chainId: LASNA_CHAIN_ID, payer: SYSTEM_CONTRACT, contractAddress: addresses.reactive, data: rcHealth },
    { label: 'Payment escrow', chainId: BASE_SEPOLIA_CHAIN_ID, payer: BASE_CALLBACK_PROXY, contractAddress: addresses.paymentEscrow, data: paymentHealth },
    { label: 'Asset escrow', chainId: UNICHAIN_SEPOLIA_CHAIN_ID, payer: UNICHAIN_CALLBACK_PROXY, contractAddress: addresses.assetEscrow, data: assetHealth },
  ];

  const terms = order
    ? [
        `| Buyer | \`${order.buyer}\` |`,
        `| Seller | \`${order.seller}\` |`,
        `| Payment token / amount | \`${order.paymentToken}\` / ${order.paymentAmount} |`,
        `| Asset token / amount | \`${order.assetToken}\` / ${order.assetAmount} |`,
        `| Deadline | ${new Date(Number(order.deadline) * 1000).toISOString()} (${order.deadline}) |`,
        `| Flags | paymentSeen=${order.paymentSeen}, assetSeen=${order.assetSeen}, settleRequested=${order.settleRequested}, refundRequested=${order.refundRequested}, paymentClosed=${order.paymentClosed}, assetClosed=${order.assetClosed}, invalid=${order.invalid} |`,
        `| Nonce | ${order.nonce} |`,
        `| Last action | ${order.lastActionTimestamp} |`,
      ].join('\n')
    : '_Order state unavailable — check RC_ADDRESS and the RPC._';

  const payloadRows =
    proof.callbacks.length === 0
      ? '| _none decoded_ | — | — | — | — |'
      : proof.callbacks
          .map(
            (callback) =>
              `| [${callback.txHash.slice(0, 10)}…](${explorerTxLink(LASNA_CHAIN_ID, callback.txHash)}) | ${chainName(
                callback.destinationChainId,
              )} | \`${callback.recipient}\` | ${callback.gasLimit} | ${callback.functionName}(${callback.args
                .slice(1)
                .map((arg) => String(arg))
                .join(', ')}) |`,
          )
          .join('\n');

  const healthTable = [
    '| Contract | Chain | Address | debt | reserves | native balance |',
    '|---|---|---|---:|---:|---:|',
    ...healthRows.map(
      (row) =>
        `| ${row.label} | ${chainName(row.chainId)} (${row.chainId}) | \`${row.contractAddress}\` | ${row.data.debt} | ${row.data.reserves} | ${row.data.balance} |`,
    ),
  ].join('\n');

  const verificationCommands = commandBlock([
    ...healthRows.flatMap((row) => [
      `cast call --rpc-url ${row.chainId === LASNA_CHAIN_ID ? '$REACTIVE_RPC' : row.chainId === BASE_SEPOLIA_CHAIN_ID ? '$BASE_RPC' : '$UNICHAIN_RPC'} ${row.payer} "debt(address)(uint256)" ${row.contractAddress}`,
      `cast call --rpc-url ${row.chainId === LASNA_CHAIN_ID ? '$REACTIVE_RPC' : row.chainId === BASE_SEPOLIA_CHAIN_ID ? '$BASE_RPC' : '$UNICHAIN_RPC'} ${row.payer} "reserves(address)(uint256)" ${row.contractAddress}`,
    ]),
    ...proof.hops.map(
      (hop) =>
        `cast receipt --rpc-url ${hop.chainId === LASNA_CHAIN_ID ? '$REACTIVE_RPC' : hop.chainId === BASE_SEPOLIA_CHAIN_ID ? '$BASE_RPC' : '$UNICHAIN_RPC'} ${hop.txHash}`,
    ),
    `cast call --rpc-url $REACTIVE_RPC ${addresses.reactive} "getOrder(bytes32)" ${orderId}`,
    'forge verify-contract --verifier sourcify --chain-id 5318007 <RC> src/HandshakeReactive.sol:HandshakeReactive',
  ]);

  const markdown = [
    `# Handshake proof bundle — \`${orderId}\``,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Settlement is **eventually atomic** via callbacks, not a single atomic transaction; timestamps have 1-second EVM granularity and observer delay is disclosed in `latency.json`.',
    '',
    '## Order terms (Lasna)',
    '',
    terms,
    '',
    '## Hop timeline',
    '',
    proofTable(proof),
    '',
    '## Callback payloads (decoded from CallbackRequest)',
    '',
    '| Reactive tx | Destination chain | Recipient | gasLimit | Decoded call |',
    '|---|---|---|---:|---|',
    payloadRows,
    '',
    '## Debt / reserves snapshot',
    '',
    healthTable,
    '',
    '## Verification commands',
    '',
    verificationCommands,
    '',
  ].join('\n');

  const out = process.env.PROOF_OUT ?? 'proof.md';
  writeFileSync(out, markdown);
  console.log(markdown);
  console.log(`\nWrote ${out}`);
}

await main();
