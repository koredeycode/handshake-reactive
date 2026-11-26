import { readFileSync, writeFileSync } from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { reactiveAbi, systemAbi } from './abis.js';
import {
  BASE_CALLBACK_PROXY,
  BASE_SEPOLIA_CHAIN_ID,
  CHAINS,
  LASNA_CHAIN_ID,
  SYSTEM_CONTRACT,
  UNICHAIN_CALLBACK_PROXY,
  UNICHAIN_SEPOLIA_CHAIN_ID,
  deployedAddresses,
  explorerTxLink,
  rpcUrl,
  type SupportedChainId,
} from './networks.js';

type Artifact = { abi: Abi; bytecode: { object: string } };
type DeployResult = { address: Address; txHash: Hex };

function loadArtifact(path: string): Artifact {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Missing artifact ${path}. Run \`forge build\` first, or set *_ARTIFACT env vars.`);
  }
  const artifact = JSON.parse(raw) as Artifact;
  if (!artifact.bytecode?.object || artifact.bytecode.object === '0x') {
    throw new Error(`Artifact ${path} has empty bytecode — run \`forge build\` after merging the contracts branch.`);
  }
  return artifact;
}

const envArtifact = (name: string, fallback: string): string => process.env[name] ?? fallback;

function envAddress(name: keyof NodeJS.ProcessEnv): Address | undefined {
  const value = process.env[name as string];
  return value && value !== '0x0000000000000000000000000000000000000000' ? (value as Address) : undefined;
}

const envUint = (name: string, fallback: bigint): bigint =>
  process.env[name] ? BigInt(process.env[name]!) : fallback;

async function main(): Promise<void> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY must be set in your shell/dotenv. Never commit it to the repo.');
  }
  const account = privateKeyToAccount(privateKey as Hex);
  const existing = deployedAddresses();
  const txHashes: Record<string, Hex> = {};

  const publicClient = (chainId: SupportedChainId) =>
    createPublicClient({ chain: CHAINS[chainId], transport: http(rpcUrl(chainId)) });
  const walletClient = (chainId: SupportedChainId) =>
    createWalletClient({ account, chain: CHAINS[chainId], transport: http(rpcUrl(chainId)) });

  async function deploy(chainId: SupportedChainId, artifactPath: string, args: unknown[], value: bigint, label: string): Promise<Address> {
    const override = envAddress(label === 'RC' ? 'RC_ADDRESS' : label === 'PaymentEscrow' ? 'PAYMENT_ESCROW_ADDRESS' : label === 'AssetEscrow' ? 'ASSET_ESCROW_ADDRESS' : label === 'TestUSD' ? 'PAYMENT_TOKEN_ADDRESS' : 'ASSET_TOKEN_ADDRESS');
    if (override) {
      console.log(`${label}: reusing ${override}`);
      return override;
    }
    const artifact = loadArtifact(artifactPath);
    const hash = await walletClient(chainId).deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object as Hex,
      args,
      value,
    });
    const receipt = await publicClient(chainId).waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`${label} deployment did not return a contract address`);
    txHashes[label] = hash;
    console.log(`${label}: ${receipt.contractAddress} (${explorerTxLink(chainId, hash)})`);
    return receipt.contractAddress;
  }

  // 1. RC on Lasna first, funded with a little lREACT — no subscriptions yet.
  const rc = await deploy(
    LASNA_CHAIN_ID,
    envArtifact('RC_ARTIFACT', 'out/HandshakeReactive.sol/HandshakeReactive.json'),
    [],
    envUint('RC_DEPLOY_VALUE_WEI', 50_000_000_000_000_000n),
    'RC',
  );

  // 2. Test tokens.
  const paymentToken = await deploy(
    BASE_SEPOLIA_CHAIN_ID,
    envArtifact('PAYMENT_TOKEN_ARTIFACT', 'out/TestUSD.sol/TestUSD.json'),
    [],
    0n,
    'TestUSD',
  );
  const assetToken = await deploy(
    UNICHAIN_SEPOLIA_CHAIN_ID,
    envArtifact('ASSET_TOKEN_ARTIFACT', 'out/TestAsset.sol/TestAsset.json'),
    [],
    0n,
    'TestAsset',
  );

  // 3. Escrows with the RC address baked in (immutable callbackSender).
  const paymentEscrow = await deploy(
    BASE_SEPOLIA_CHAIN_ID,
    envArtifact('PAYMENT_ESCROW_ARTIFACT', 'out/PaymentEscrow.sol/PaymentEscrow.json'),
    [BASE_CALLBACK_PROXY, rc, paymentToken],
    0n,
    'PaymentEscrow',
  );
  const assetEscrow = await deploy(
    UNICHAIN_SEPOLIA_CHAIN_ID,
    envArtifact('ASSET_ESCROW_ARTIFACT', 'out/AssetEscrow.sol/AssetEscrow.json'),
    [UNICHAIN_CALLBACK_PROXY, rc, assetToken],
    0n,
    'AssetEscrow',
  );

  // 4. Subscriptions — only possible now that both escrow addresses are known.
  const setVenuesHash = await walletClient(LASNA_CHAIN_ID).writeContract({
    address: rc,
    abi: reactiveAbi,
    functionName: 'setVenues',
    args: [BigInt(BASE_SEPOLIA_CHAIN_ID), paymentEscrow, BigInt(UNICHAIN_SEPOLIA_CHAIN_ID), assetEscrow],
  });
  await publicClient(LASNA_CHAIN_ID).waitForTransactionReceipt({ hash: setVenuesHash });
  txHashes.setVenues = setVenuesHash;
  console.log(`setVenues: ${explorerTxLink(LASNA_CHAIN_ID, setVenuesHash)}`);

  // 5. Funding (SYSTEM.depositTo + both proxies). Enabled by default in this helper.
  if ((process.env.AUTO_FUND ?? '1') !== '0') {
    const funding: Array<{ chainId: SupportedChainId; to: Address; target: Address; amount: bigint; label: string }> = [
      { chainId: LASNA_CHAIN_ID, to: SYSTEM_CONTRACT, target: rc, amount: envUint('RC_FUND_AMOUNT_WEI', 10n ** 18n), label: 'RC reserves' },
      { chainId: BASE_SEPOLIA_CHAIN_ID, to: BASE_CALLBACK_PROXY, target: paymentEscrow, amount: envUint('PAYMENT_RESERVE_WEI', 20_000_000_000_000_000n), label: 'Payment escrow reserves' },
      { chainId: UNICHAIN_SEPOLIA_CHAIN_ID, to: UNICHAIN_CALLBACK_PROXY, target: assetEscrow, amount: envUint('ASSET_RESERVE_WEI', 20_000_000_000_000_000n), label: 'Asset escrow reserves' },
    ];
    for (const item of funding) {
      const data = encodeFunctionData({ abi: systemAbi, functionName: 'depositTo', args: [item.target] });
      const hash = await walletClient(item.chainId).sendTransaction({ to: item.to, data, value: item.amount });
      await publicClient(item.chainId).waitForTransactionReceipt({ hash });
      txHashes[item.label] = hash;
      const debt = await publicClient(item.chainId).readContract({
        address: item.to,
        abi: systemAbi,
        functionName: 'debt',
        args: [item.target],
      });
      console.log(`${item.label}: funded (${hash}), debt=${debt}`);
    }
  }

  const manifest = {
    chainIds: { lasna: LASNA_CHAIN_ID, baseSepolia: BASE_SEPOLIA_CHAIN_ID, unichainSepolia: UNICHAIN_SEPOLIA_CHAIN_ID },
    systemContract: SYSTEM_CONTRACT,
    callbackProxies: { [BASE_SEPOLIA_CHAIN_ID]: BASE_CALLBACK_PROXY, [UNICHAIN_SEPOLIA_CHAIN_ID]: UNICHAIN_CALLBACK_PROXY },
    reactive: rc,
    paymentToken,
    assetToken,
    paymentEscrow,
    assetEscrow,
    txHashes,
    signer: account.address,
  };
  const out = process.env.DEPLOYMENT_MANIFEST ?? 'deployments.json';
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nManifest written to ${out}. Existing env addresses: ${JSON.stringify(existing)}`);
  console.log('Next: bash scripts/preflight.sh, then npm run observe -- and npm run proofs -- <orderId>');
}

await main();
