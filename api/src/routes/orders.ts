import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client.js';
import { orderEvents, orderLegs, orders } from '../db/schema.js';

export const orderRoutes = new Hono();

const listQuery = z.object({
  status: z.string().optional(),
  chain: z.coerce.number().int().positive().optional(),
  cursor: z.string().default(''),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

orderRoutes.get('/orders', async (c) => {
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'invalid query', issues: parsed.error.flatten() }, 400);
  const { status, chain, cursor, limit } = parsed.data;
  const conditions = [];
  if (status) conditions.push(eq(orders.status, status));
  if (chain) conditions.push(or(eq(orders.paymentChainId, chain), eq(orders.assetChainId, chain)));
  if (cursor) conditions.push(gt(orders.orderId, cursor));
  const rows = await db.select().from(orders)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(orders.orderId))
    .limit(limit + 1);
  const items = rows.slice(0, limit);
  return c.json({
    items,
    nextCursor: rows.length > limit ? items[items.length - 1]?.orderId ?? null : null,
    limit,
  });
});

orderRoutes.get('/orders/:id/events', async (c) => {
  const orderId = c.req.param('id');
  const rows = await db.select().from(orderEvents)
    .where(and(sql`${orderEvents.payload}->>'orderId' = ${orderId}`, eq(orderEvents.removed, false)))
    .orderBy(asc(orderEvents.blockNumber), asc(orderEvents.txHash), asc(orderEvents.logIndex))
    .limit(500);
  return c.json({ orderId, events: rows });
});

orderRoutes.get('/orders/:id', async (c) => {
  const orderId = c.req.param('id');
  const [order] = await db.select().from(orders).where(eq(orders.orderId, orderId)).limit(1);
  if (!order) return c.json({ error: 'order not found' }, 404);
  const legs = await db.select().from(orderLegs).where(eq(orderLegs.orderId, orderId));
  const events = await db.select().from(orderEvents)
    .where(and(sql`${orderEvents.payload}->>'orderId' = ${orderId}`, eq(orderEvents.removed, false)))
    .orderBy(asc(orderEvents.blockNumber), asc(orderEvents.logIndex))
    .limit(200);
  const timeline = events.map((event) => ({
    at: event.receivedAt,
    chainId: event.chainId,
    txHash: event.txHash,
    blockNumber: event.blockNumber,
    logIndex: event.logIndex,
    stage: event.eventName,
    payload: event.payload,
  }));
  return c.json({ ...order, legs, timeline });
});

// Keyset pagination helper kept here for the status board /health counters.
export async function statusCounts(): Promise<Record<string, number>> {
  const rows = await db.select({ status: orders.status, count: sql<number>`count(*)::int` })
    .from(orders).groupBy(orders.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}
