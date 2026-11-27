import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createPublicClient, http, keccak256, toHex } from 'viem';
import { z } from 'zod';
import { httpUrlFor } from '../config.js';
import { CHAIN_BY_ID, CURATED_TOKENS, tokenMetadataAbi } from '../contracts.js';
import { db } from '../db/client.js';
import { tokens } from '../db/schema.js';
import { log } from '../lib/log.js';

export const tokenRoutes = new Hono();

const listQuery = z.object({
  chainId: z.coerce.number().int().positive().optional(),
  verified: z.enum(['true', 'false']).optional(),
});

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

tokenRoutes.get('/tokens', async (c) => {
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'invalid query', issues: parsed.error.flatten() }, 400);
  const { chainId, verified } = parsed.data;
  const conditions = [];
  if (chainId) conditions.push(eq(tokens.chainId, chainId));
  if (verified) conditions.push(eq(tokens.verified, verified === 'true'));
  const rows = await db.select().from(tokens)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tokens.verified), desc(tokens.chainId));
  return c.json({ tokens: rows });
});

const validateBody = z.object({
  chainId: z.coerce.number().int().positive(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/** Server-side symbol/decimals lookup; a failed call is persisted as unverified. */
tokenRoutes.post('/tokens/validate', async (c) => {
  const body = await c.req.json().catch(() => undefined);
  const parsed = validateBody.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.flatten() }, 400);
  const { chainId, address } = parsed.data;
  if (!CHAIN_BY_ID.has(chainId) || chainId === 5318007) {
    return c.json({ error: 'unsupported chain' }, 400);
  }
  const client = clientFor(chainId);
  let symbol: string | undefined;
  let decimals: number | undefined;
  try {
    symbol = await client.readContract({ address: address as `0x${string}`, abi: tokenMetadataAbi, functionName: 'symbol' });
    decimals = await client.readContract({ address: address as `0x${string}`, abi: tokenMetadataAbi, functionName: 'decimals' });
  } catch (error) {
    log.warn({ err: error, chainId, address }, 'token metadata lookup failed');
  }
  const verified = symbol !== undefined && decimals !== undefined;
  const [existing] = await db.select().from(tokens)
    .where(and(eq(tokens.chainId, chainId), eq(tokens.address, address))).limit(1);
  const [row] = await db.insert(tokens).values({
    chainId, address, symbol: symbol ?? existing?.symbol ?? null,
    decimals: decimals ?? existing?.decimals ?? null,
    verified,
    source: existing?.source ?? (CURATED_TOKENS.some((token) => token.chainId === chainId && token.address.toLowerCase() === address.toLowerCase()) ? 'curated' : 'custom'),
    metadataHash: verified ? keccak256(toHex(`${symbol}:${decimals}`)) : null,
  }).onConflictDoUpdate({
    target: [tokens.chainId, tokens.address],
    set: {
      symbol: symbol ?? null,
      decimals: decimals ?? null,
      verified,
      metadataHash: verified ? keccak256(toHex(`${symbol}:${decimals}`)) : null,
    },
  }).returning();
  return c.json({ token: row, verified });
});
