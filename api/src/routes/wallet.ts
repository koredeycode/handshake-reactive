import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from 'viem';
import { z } from 'zod';
import { env, httpUrlFor } from '../config.js';
import { CHAIN_BY_ID, MULTICALL3, multicall3Abi, tokenMetadataAbi } from '../contracts.js';
import { db } from '../db/client.js';
import { tokens, walletCache } from '../db/schema.js';
import { log } from '../lib/log.js';
import { metrics } from '../lib/metrics.js';

export const walletRoutes = new Hono();

const NATIVE = 'native';
const MAX_TOKENS = 100;

const clients = new Map<number, ReturnType<typeof createClient>>();
function createClient(chainId: number) {
  return createPublicClient({ transport: http(httpUrlFor(chainId)) });
}
function clientFor(chainId: number) {
  let client = clients.get(chainId);
  if (!client) {
    client = createClient(chainId);
    clients.set(chainId, client);
  }
  return client;
}

const querySchema = z.object({
  chainIds: z.string().optional(),
  force: z.enum(['1', 'true']).optional(),
});

type TokenBalance = {
  address: string;
  symbol: string | null;
  decimals: number | null;
  balance: string;
  verified: boolean;
  chainId: number;
};

type ChainBalances = { native: string; tokens: TokenBalance[] };

/** The cache is an optimization only: any DB failure falls through to RPC. */
async function cachedBalance(wallet: string, chainId: number, token: string, force: boolean): Promise<string | undefined> {
  if (force) return undefined;
  try {
    const [row] = await db.select().from(walletCache)
      .where(and(
        eq(walletCache.wallet, wallet),
        eq(walletCache.chainId, chainId),
        eq(walletCache.token, token),
      )).limit(1);
    if (!row) return undefined;
    if (Date.now() - new Date(row.fetchedAt).getTime() > env.WALLET_CACHE_TTL_MS) return undefined;
    metrics.walletCacheReads.inc({ result: 'hit' });
    return row.balance;
  } catch (error) {
    metrics.dbFailures.inc();
    log.warn({ err: error, wallet, chainId, token }, 'wallet cache read failed; using RPC');
    return undefined;
  }
}

async function saveCache(wallet: string, chainId: number, token: string, balance: string, blockNumber: number): Promise<void> {
  try {
    await db.insert(walletCache).values({ wallet, chainId, token, balance, blockNumber })
      .onConflictDoUpdate({
        target: [walletCache.wallet, walletCache.chainId, walletCache.token],
        set: { balance, blockNumber, fetchedAt: new Date() },
      });
  } catch (error) {
    metrics.dbFailures.inc();
    log.warn({ err: error, wallet, chainId, token }, 'wallet cache write failed; balance still returned');
  }
}

async function balancesForChain(wallet: string, chainId: number, force: boolean): Promise<{ data: ChainBalances; blockNumber: number }> {
  const client = clientFor(chainId);
  const blockNumber = Number(await client.getBlockNumber());
  const catalog = await db.select().from(tokens).where(eq(tokens.chainId, chainId)).limit(MAX_TOKENS);
  const cachedNative = await cachedBalance(wallet, chainId, NATIVE, force);
  let native = cachedNative;
  if (native === undefined) {
    metrics.walletCacheReads.inc({ result: 'miss' });
    native = (await client.getBalance({ address: wallet as Address })).toString();
    await saveCache(wallet, chainId, NATIVE, native, blockNumber);
  }

  const result: TokenBalance[] = [];
  const pending: Array<{ token: typeof catalog[number]; address: Address }> = [];
  for (const token of catalog) {
    const hit = await cachedBalance(wallet, chainId, token.address, force);
    if (hit !== undefined) {
      result.push({
        address: token.address, symbol: token.symbol, decimals: token.decimals,
        balance: hit, verified: token.verified, chainId,
      });
    } else {
      metrics.walletCacheReads.inc({ result: 'miss' });
      pending.push({ token, address: token.address as Address });
    }
  }

  if (pending.length > 0) {
    const calls = pending.map(({ address }) => ({
      target: MULTICALL3,
      allowFailure: true,
      callData: encodeFunctionData({ abi: tokenMetadataAbi, functionName: 'balanceOf', args: [wallet as Address] }),
    }));
    // balanceOf is on the token, not Multicall3: rebuild each call with the
    // token as target while still batching into one eth_call.
    calls.forEach((call, index) => {
      call.target = pending[index]!.address;
    });
    const aggregates = (await client.readContract({
      address: MULTICALL3,
      abi: multicall3Abi,
      functionName: 'aggregate3',
      args: [calls],
    })) as Array<{ success: boolean; returnData: Hex } | undefined>;
    for (let index = 0; index < pending.length; index += 1) {
      const entry = aggregates[index];
      const { token } = pending[index]!;
      let balance = '0';
      if (entry?.success && entry.returnData) {
        try {
          const decoded = decodeFunctionResult({
            abi: tokenMetadataAbi, functionName: 'balanceOf', data: entry.returnData as Hex,
          });
          balance = (decoded as bigint).toString();
        } catch {
          balance = '0';
        }
      }
      await saveCache(wallet, chainId, token.address, balance, blockNumber);
      result.push({
        address: token.address, symbol: token.symbol, decimals: token.decimals,
        balance, verified: token.verified, chainId,
      });
    }
  }

  return { data: { native, tokens: result }, blockNumber };
}

walletRoutes.get('/wallet/:address/balances', async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'invalid query', issues: parsed.error.flatten() }, 400);
  const wallet = c.req.param('address');
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return c.json({ error: 'invalid address' }, 400);
  const normalized = wallet.toLowerCase();
  const requested = parsed.data.chainIds?.split(',').map((value) => Number(value.trim())).filter(Boolean);
  const chainIds = requested && requested.length > 0
    ? requested.filter((id) => CHAIN_BY_ID.has(id) && id !== 5318007)
    : [...CHAIN_BY_ID.keys()].filter((id) => id !== 5318007);
  if (chainIds.length === 0) return c.json({ error: 'no valid chainIds' }, 400);
  const chains: Record<string, ChainBalances> = {};
  const blockNumbers: Record<string, number> = {};
  await Promise.all(chainIds.map(async (chainId) => {
    const { data, blockNumber } = await balancesForChain(normalized, chainId, Boolean(parsed.data.force));
    chains[String(chainId)] = data;
    blockNumbers[String(chainId)] = blockNumber;
  }));
  return c.json({ address: normalized, chains, fetchedAt: new Date().toISOString(), blockNumbers });
});

walletRoutes.get('/wallet/:address/tokens', async (c) => {
  const wallet = c.req.param('address');
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return c.json({ error: 'invalid address' }, 400);
  const chainIds = [...CHAIN_BY_ID.keys()].filter((id) => id !== 5318007);
  const result: TokenBalance[] = [];
  await Promise.all(chainIds.map(async (chainId) => {
    const { data } = await balancesForChain(wallet.toLowerCase(), chainId, false);
    result.push(...data.tokens.filter((token) => BigInt(token.balance) > 0n));
  }));
  return c.json({ address: wallet.toLowerCase(), tokens: result });
});
