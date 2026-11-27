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
  readManifest,
  rpcUrl,
  type SupportedChainId,
} from './networks.js';

type Artifact = { abi: Abi; bytecode: { object: string } };
type EscrowRole = 'paymentEscrow' | 'assetEscrow';
type Venue = { chainId: number; paymentEscrow: Address; assetEscrow: Address };

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;
/** 6 escrow subscriptions per registered chain + the single legacy Cron10 subscription. */
const EXPECTED_SUBSCRIPTIONS = 19;

/** Env overrides keyed by the label passed to `deploy()`. */
const ADDRESS_ENV: Record<string, string> = {
  RC: 'RC_ADDRESS',
  TestUSD: 'PAYMENT_TOKEN_ADDRESS',
  TestAsset: 'ASSET_TOKEN_ADDRESS',
  PaymentEscrow: 'PAYMENT_ESCROW_ADDRESS',
  AssetEscrow: 'ASSET_ESCROW_ADDRESS',
  BaseAssetEscrow: 'BASE_ASSET_ESCROW_ADDRESS',
  UnichainPaymentEscrow: 'UNICHAIN_PAYMENT_ESCROW_ADDRESS',
};

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

function envAddress(name: string): Address | undefined {
  const value = process.env[name];
  return value && value !== ZERO_ADDRESS ? (value as Address) : undefined;
}

const envUint = (name: string, fallback: bigint): bigint =>
  process.env[name] ? BigInt(process.env[name]!) : fallback;

/** Reads a previously deployed venue address out of the manifest. */
function manifestVenue(chainId: number, role: EscrowRole): Address | undefined {
  const previous = readManifest() as {
    venues?: Record<string, Partial<Record<EscrowRole, Address>>>;
  };
  const value = previous.venues?.[String(chainId)]?.[role];
  return value && value !== ZERO_ADDRESS ? value : undefined;
}

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

  async function deploy(
    chainId: SupportedChainId,
    artifactPath: string,
    args: unknown[],
    value: bigint,
    label: string,
  ): Promise<Address> {
    const override = envAddress(ADDRESS_ENV[label] ?? '');
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

  // 3. Escrows. Constructors pin the callback proxy and the reactive sender only;
  //    tokens are supplied per leg by `lock()` and validated against the order's terms.
  const paymentArtifact = envArtifact('PAYMENT_ESCROW_ARTIFACT', 'out/PaymentEscrow.sol/PaymentEscrow.json');
  const assetArtifact = envArtifact('ASSET_ESCROW_ARTIFACT', 'out/AssetEscrow.sol/AssetEscrow.json');
  const paymentEscrow = await deploy(
    BASE_SEPOLIA_CHAIN_ID,
    paymentArtifact,
    [BASE_CALLBACK_PROXY, rc],
    0n,
    'PaymentEscrow',
  );
  const assetEscrow = await deploy(
    UNICHAIN_SEPOLIA_CHAIN_ID,
    assetArtifact,
    [UNICHAIN_CALLBACK_PROXY, rc],
    0n,
    'AssetEscrow',
  );

  // Each registered chain needs BOTH roles. Reuse env/manifest addresses when present;
  // otherwise deploy the missing counterpart escrow on that chain with the same 2-arg ctor.
  let baseAssetEscrow = envAddress('BASE_ASSET_ESCROW_ADDRESS') ?? manifestVenue(BASE_SEPOLIA_CHAIN_ID, 'assetEscrow');
  if (!baseAssetEscrow) {
    baseAssetEscrow = await deploy(BASE_SEPOLIA_CHAIN_ID, assetArtifact, [BASE_CALLBACK_PROXY, rc], 0n, 'BaseAssetEscrow');
  }
  let unichainPaymentEscrow =
    envAddress('UNICHAIN_PAYMENT_ESCROW_ADDRESS') ?? manifestVenue(UNICHAIN_SEPOLIA_CHAIN_ID, 'paymentEscrow');
  if (!unichainPaymentEscrow) {
    unichainPaymentEscrow = await deploy(
      UNICHAIN_SEPOLIA_CHAIN_ID,
      paymentArtifact,
      [UNICHAIN_CALLBACK_PROXY, rc],
      0n,
      'UnichainPaymentEscrow',
    );
  }

  // Ethereum Sepolia escrows are deployed out of band: this helper has no Sepolia
  // chain/proxy config, so resolve them from env overrides or the previous manifest.
  const sepoliaPaymentEscrow =
    envAddress('SEPOLIA_PAYMENT_ESCROW_ADDRESS') ?? manifestVenue(ETHEREUM_SEPOLIA_CHAIN_ID, 'paymentEscrow');
  const sepoliaAssetEscrow =
    envAddress('SEPOLIA_ASSET_ESCROW_ADDRESS') ?? manifestVenue(ETHEREUM_SEPOLIA_CHAIN_ID, 'assetEscrow');
  if (!sepoliaPaymentEscrow || !sepoliaAssetEscrow) {
    throw new Error(
      'Registering the Ethereum Sepolia venue requires SEPOLIA_PAYMENT_ESCROW_ADDRESS and ' +
        'SEPOLIA_ASSET_ESCROW_ADDRESS (or matching venues[11155111] entries in the deployment manifest).',
    );
  }

  // 4. Three venues on the single RC. First call also installs the one Cron10 subscription.
  const venues: Venue[] = [
    { chainId: BASE_SEPOLIA_CHAIN_ID, paymentEscrow, assetEscrow: baseAssetEscrow },
    { chainId: UNICHAIN_SEPOLIA_CHAIN_ID, paymentEscrow: unichainPaymentEscrow, assetEscrow },
    { chainId: ETHEREUM_SEPOLIA_CHAIN_ID, paymentEscrow: sepoliaPaymentEscrow, assetEscrow: sepoliaAssetEscrow },
  ];
  for (const venue of venues) {
    const hash = await walletClient(LASNA_CHAIN_ID).writeContract({
      address: rc,
      abi: reactiveAbi,
      functionName: 'setVenue',
      args: [BigInt(venue.chainId), venue.paymentEscrow, venue.assetEscrow],
    });
    await publicClient(LASNA_CHAIN_ID).waitForTransactionReceipt({ hash });
    txHashes[`setVenue-${venue.chainId}`] = hash;
    console.log(`setVenue(${venue.chainId}, ${venue.paymentEscrow}, ${venue.assetEscrow}): ${explorerTxLink(LASNA_CHAIN_ID, hash)}`);
  }
  const subscriptionCount = await publicClient(LASNA_CHAIN_ID).readContract({
    address: rc,
    abi: reactiveAbi,
    functionName: 'subscriptionCount',
  });
  console.log(`subscriptionCount: ${subscriptionCount} (expected ${EXPECTED_SUBSCRIPTIONS})`);

  // 5. Funding (SYSTEM.depositTo + both chain-local proxies). Enabled by default.
  if ((process.env.AUTO_FUND ?? '1') !== '0') {
    const funding: Array<{ chainId: SupportedChainId; to: Address; target: Address; amount: bigint; label: string }> = [
      { chainId: LASNA_CHAIN_ID, to: SYSTEM_CONTRACT, target: rc, amount: envUint('RC_FUND_AMOUNT_WEI', 10n ** 18n), label: 'RC reserves' },
      { chainId: BASE_SEPOLIA_CHAIN_ID, to: BASE_CALLBACK_PROXY, target: paymentEscrow, amount: envUint('PAYMENT_RESERVE_WEI', 20_000_000_000_000_000n), label: 'Base payment escrow reserves' },
      { chainId: BASE_SEPOLIA_CHAIN_ID, to: BASE_CALLBACK_PROXY, target: baseAssetEscrow, amount: envUint('ASSET_RESERVE_WEI', 20_000_000_000_000_000n), label: 'Base asset escrow reserves' },
      { chainId: UNICHAIN_SEPOLIA_CHAIN_ID, to: UNICHAIN_CALLBACK_PROXY, target: unichainPaymentEscrow, amount: envUint('PAYMENT_RESERVE_WEI', 20_000_000_000_000_000n), label: 'Unichain payment escrow reserves' },
      { chainId: UNICHAIN_SEPOLIA_CHAIN_ID, to: UNICHAIN_CALLBACK_PROXY, target: assetEscrow, amount: envUint('ASSET_RESERVE_WEI', 20_000_000_000_000_000n), label: 'Unichain asset escrow reserves' },
    ];
    // Avoid double-funding when an override points two roles at the same address.
    const seen = new Set<string>();
    for (const item of funding) {
      const key = `${item.chainId}:${item.target.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
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
    console.log('Ethereum Sepolia escrow proxies must be funded separately (no Sepolia proxy configured here).');
  }

  const manifest = {
    chainIds: {
      lasna: LASNA_CHAIN_ID,
      baseSepolia: BASE_SEPOLIA_CHAIN_ID,
      unichainSepolia: UNICHAIN_SEPOLIA_CHAIN_ID,
      ethereumSepolia: ETHEREUM_SEPOLIA_CHAIN_ID,
    },
    systemContract: SYSTEM_CONTRACT,
    callbackProxies: { [BASE_SEPOLIA_CHAIN_ID]: BASE_CALLBACK_PROXY, [UNICHAIN_SEPOLIA_CHAIN_ID]: UNICHAIN_CALLBACK_PROXY },
    reactive: rc,
    paymentToken,
    assetToken,
    paymentEscrow,
    assetEscrow,
    baseAssetEscrow,
    unichainPaymentEscrow,
    sepoliaPaymentEscrow,
    sepoliaAssetEscrow,
    venues: {
      [BASE_SEPOLIA_CHAIN_ID]: { paymentEscrow, assetEscrow: baseAssetEscrow },
      [UNICHAIN_SEPOLIA_CHAIN_ID]: { paymentEscrow: unichainPaymentEscrow, assetEscrow },
      [ETHEREUM_SEPOLIA_CHAIN_ID]: { paymentEscrow: sepoliaPaymentEscrow, assetEscrow: sepoliaAssetEscrow },
    },
    expectedSubscriptions: EXPECTED_SUBSCRIPTIONS,
    txHashes,
    signer: account.address,
  };
  const out = process.env.DEPLOYMENT_MANIFEST ?? 'deployments.json';
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nManifest written to ${out}. Existing env addresses: ${JSON.stringify(existing)}`);
  console.log('Next: bash scripts/preflight.sh, then npm run observe -- and npm run proofs -- <orderId>');
}

await main();
