import { readFileSync } from 'node:fs';
import { defineChain, type Address } from 'viem';

/** Canonical network constants from the PRD (§11.1 and §9b). */
export const LASNA_CHAIN_ID = 5318007;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
export const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

export const SYSTEM_CONTRACT = '0x8888888888888888888888888888888888888888' as const satisfies Address;
export const BASE_CALLBACK_PROXY = '0x476F44b11F5C942c58f4c8E3d0300E5710743585' as const satisfies Address;
export const UNICHAIN_CALLBACK_PROXY = '0x775c9B990ADe401060B78D0e98684eEf8d2466C1' as const satisfies Address;
export const SEPOLIA_CALLBACK_PROXY = '0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4' as const satisfies Address;

export const lasna = defineChain({
  id: LASNA_CHAIN_ID,
  name: 'Reactive Lasna',
  nativeCurrency: { name: 'lREACT', symbol: 'lREACT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://lasna-rpc.rnk.dev/'], webSocket: ['wss://lasna-rpc.rnk.dev/'] },
  },
  blockExplorers: { default: { name: 'Reactscan', url: 'https://lasna.reactscan.net' } },
});

export const baseSepolia = defineChain({
  id: BASE_SEPOLIA_CHAIN_ID,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org'], webSocket: ['wss://sepolia.base.org'] },
  },
  blockExplorers: { default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' } },
  testnet: true,
});

export const unichainSepolia = defineChain({
  id: UNICHAIN_SEPOLIA_CHAIN_ID,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.unichain.org'], webSocket: ['wss://sepolia.unichain.org'] },
  },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' } },
  testnet: true,
});

export const ethereumSepolia = defineChain({
  id: ETHEREUM_SEPOLIA_CHAIN_ID,
  name: 'Ethereum Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://ethereum-sepolia-rpc.publicnode.com'], webSocket: ['wss://ethereum-sepolia-rpc.publicnode.com'] },
  },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' } },
  testnet: true,
});

export const CHAINS = {
  [LASNA_CHAIN_ID]: lasna,
  [BASE_SEPOLIA_CHAIN_ID]: baseSepolia,
  [UNICHAIN_SEPOLIA_CHAIN_ID]: unichainSepolia,
  [ETHEREUM_SEPOLIA_CHAIN_ID]: ethereumSepolia,
} as const;

export type SupportedChainId = keyof typeof CHAINS;

export const CHAIN_ENV: Record<SupportedChainId, string> = {
  [LASNA_CHAIN_ID]: 'REACTIVE_RPC',
  [BASE_SEPOLIA_CHAIN_ID]: 'BASE_RPC',
  [UNICHAIN_SEPOLIA_CHAIN_ID]: 'UNICHAIN_RPC',
  [ETHEREUM_SEPOLIA_CHAIN_ID]: 'SEPOLIA_RPC',
};

export const WS_ENV: Record<SupportedChainId, string> = {
  [LASNA_CHAIN_ID]: 'REACTIVE_WS',
  [BASE_SEPOLIA_CHAIN_ID]: 'BASE_WS',
  [UNICHAIN_SEPOLIA_CHAIN_ID]: 'UNICHAIN_WS',
  [ETHEREUM_SEPOLIA_CHAIN_ID]: 'SEPOLIA_WS',
};

export const EXPLORER_TX: Record<SupportedChainId, string> = {
  [LASNA_CHAIN_ID]: 'https://lasna.reactscan.net/tx',
  [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.basescan.org/tx',
  [UNICHAIN_SEPOLIA_CHAIN_ID]: 'https://sepolia.uniscan.xyz/tx',
  [ETHEREUM_SEPOLIA_CHAIN_ID]: 'https://sepolia.etherscan.io/tx',
};

export const CALLBACK_PROXY: Record<number, Address> = {
  [BASE_SEPOLIA_CHAIN_ID]: BASE_CALLBACK_PROXY,
  [UNICHAIN_SEPOLIA_CHAIN_ID]: UNICHAIN_CALLBACK_PROXY,
  [ETHEREUM_SEPOLIA_CHAIN_ID]: SEPOLIA_CALLBACK_PROXY,
};

export function rpcUrl(chainId: SupportedChainId): string {
  return process.env[CHAIN_ENV[chainId]] ?? CHAINS[chainId].rpcUrls.default.http[0]!;
}

export function wsUrl(chainId: SupportedChainId): string {
  const explicit = process.env[WS_ENV[chainId]];
  if (explicit) return explicit;
  const http = rpcUrl(chainId);
  return http.replace(/^http/, 'ws');
}

export function explorerTxLink(chainId: SupportedChainId, hash: string): string {
  return `${EXPLORER_TX[chainId]}/${hash}`;
}

export function chainName(chainId: SupportedChainId): string {
  return CHAINS[chainId].name;
}

/** Addresses deployed by script/Deploy.s.sol; env overrides are used when present. */
export function deployedAddresses(): {
  reactive: Address;
  paymentToken: Address;
  assetToken: Address;
  paymentEscrow: Address;
  assetEscrow: Address;
  baseAssetEscrow: Address;
  unichainPaymentEscrow: Address;
  sepoliaPaymentEscrow: Address;
  sepoliaAssetEscrow: Address;
} {
  const zero = '0x0000000000000000000000000000000000000000' as Address;
  return {
    reactive: (process.env.RC_ADDRESS as Address) ?? zero,
    paymentToken: (process.env.PAYMENT_TOKEN_ADDRESS as Address) ?? zero,
    assetToken: (process.env.ASSET_TOKEN_ADDRESS as Address) ?? zero,
    paymentEscrow: (process.env.PAYMENT_ESCROW_ADDRESS as Address) ?? zero,
    assetEscrow: (process.env.ASSET_ESCROW_ADDRESS as Address) ?? zero,
    baseAssetEscrow: (process.env.BASE_ASSET_ESCROW_ADDRESS as Address) ?? zero,
    unichainPaymentEscrow: (process.env.UNICHAIN_PAYMENT_ESCROW_ADDRESS as Address) ?? zero,
    sepoliaPaymentEscrow: (process.env.SEPOLIA_PAYMENT_ESCROW_ADDRESS as Address) ?? zero,
    sepoliaAssetEscrow: (process.env.SEPOLIA_ASSET_ESCROW_ADDRESS as Address) ?? zero,
  };
}

/** Reads the manifest written by Deploy.s.sol when env vars are not set. */
export function readManifest(): Record<string, string> {
  const path = process.env.DEPLOYMENT_MANIFEST ?? 'deployments.json';
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}
