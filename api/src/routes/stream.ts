import { asc, gt, max, min } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { outbox } from '../db/schema.js';
import { bus, type PublishedEvent } from '../lib/bus.js';
import { sseEventTypeSchema, type SseEventType } from '../lib/events.js';
import { log } from '../lib/log.js';
import { activeSseClientCount, decSseClients, incSseClients, metrics } from '../lib/metrics.js';
import { statusCounts } from './orders.js';

export const streamRoutes = new Hono();

const streamQuery = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  orderId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

const connectionsByIp = new Map<string, number>();
const RETENTION_MS = env.OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function matches(event: PublishedEvent, wallet?: string, orderId?: string): boolean {
  if (orderId && event.orderId?.toLowerCase() !== orderId.toLowerCase()) return false;
  if (!wallet) return true;
  if (event.type === 'notification' || event.type === 'wallet.balance') {
    return event.wallets.some((value) => value.toLowerCase() === wallet.toLowerCase());
  }
  return true;
}

function frame(event: PublishedEvent): { id: string; event: SseEventType; data: string } {
  const parsed = sseEventTypeSchema.safeParse(event.type);
  const type = parsed.success ? parsed.data : 'heartbeat';
  return {
    id: String(event.id),
    event: type,
    data: JSON.stringify({ ...event.payload, eventId: event.id, at: event.createdAt.toISOString() }),
  };
}

streamRoutes.get('/stream', (c) => {
  const parsed = streamQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'invalid query', issues: parsed.error.flatten() }, 400);
  const { wallet, orderId } = parsed.data;
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const count = connectionsByIp.get(ip) ?? 0;
  const active = activeSseClientCount();
  if (count >= env.MAX_SSE_PER_IP || active >= env.MAX_SSE_CONNECTIONS) {
    return c.json({ error: 'too many stream connections' }, 429);
  }
  connectionsByIp.set(ip, count + 1);
  incSseClients();

  const lastHeader = c.req.header('last-event-id');
  const lastEventIdParsed = z.coerce.number().int().nonnegative().safeParse(lastHeader ?? '0');
  let lastId = lastEventIdParsed.success ? lastEventIdParsed.data : 0;

  return streamSSE(c, async (stream) => {
    let wake: (() => void) | undefined;
    const queue: PublishedEvent[] = [];
    let overflow = false;
    const unsubscribe = bus.subscribe((event) => {
      if (!matches(event, wallet, orderId)) return;
      if (queue.length >= env.SSE_BUFFER_SIZE) {
        overflow = true;
        wake?.();
        return;
      }
      queue.push(event);
      wake?.();
    });
    const heartbeat = setInterval(() => {
      wake?.();
    }, 15_000);
    heartbeat.unref();

    // Client disconnect unblocks the write loop; the finally block below is the
    // single place that releases counters/subscriptions.
    stream.onAbort(() => { wake?.(); });

    const writeEvent = async (event: PublishedEvent) => {
      await stream.writeSSE(frame(event));
    };

    try {
      await stream.write('retry: 3000\n\n');
      const bounds = await db.select({
        minId: min(outbox.id), maxId: max(outbox.id), oldest: min(outbox.createdAt),
      }).from(outbox);
      const currentId = bounds[0]?.maxId ?? 0;
      const counts = await statusCounts();
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({
          eventId: currentId,
          at: new Date().toISOString(),
          lastEventId: lastId,
          serverTime: new Date().toISOString(),
          statusCounts: {
            open: counts.open ?? 0,
            awaitingLock: counts.awaitingLock ?? 0,
            bothLocked: counts.bothLocked ?? 0,
            settling: counts.settling ?? 0,
            settled: counts.settled ?? 0,
            refunded: counts.refunded ?? 0,
            expired: counts.expired ?? 0,
          },
        }),
      });
      if (lastId > 0) {
        const expired = bounds[0]?.oldest
          ? Date.now() - new Date(bounds[0].oldest).getTime() > RETENTION_MS
          : false;
        if (expired || lastId < (bounds[0]?.minId ?? 0) - 1 || lastId > currentId) {
          await stream.writeSSE({
            id: String(currentId),
            event: 'resync',
            data: JSON.stringify({
              eventId: currentId, at: new Date().toISOString(),
              reason: 'cursor_expired', fromId: lastId, toId: currentId,
            }),
          });
          metrics.sseReplays.inc();
          lastId = currentId;
        } else {
          // Replay in bounded bursts, newest cursor first.
          let cursor = lastId;
          for (let burst = 0; burst < 20; burst += 1) {
            const rows = await db.select().from(outbox)
              .where(gt(outbox.id, cursor))
              .orderBy(asc(outbox.id))
              .limit(500);
            for (const row of rows) {
              const event: PublishedEvent = {
                id: row.id, type: row.type as SseEventType, orderId: row.orderId,
                wallets: row.wallets, payload: row.payload, createdAt: row.createdAt,
              };
              if (matches(event, wallet, orderId)) await writeEvent(event);
            }
            const last = rows[rows.length - 1];
            if (rows.length < 500 || !last) break;
            cursor = last.id;
          }
          if (cursor > lastId) metrics.sseReplays.inc();
          lastId = Math.max(lastId, currentId);
        }
      } else {
        lastId = currentId;
      }

      let lastPing = Date.now();
      while (!stream.closed && !stream.aborted) {
        if (overflow) {
          await stream.writeSSE({
            id: String(currentId),
            event: 'resync',
            data: JSON.stringify({
              eventId: currentId, at: new Date().toISOString(),
              reason: 'buffer_overflow', fromId: lastId, toId: currentId,
            }),
          });
          metrics.sseOverflow.inc();
          break;
        }
        if (queue.length === 0) {
          if (Date.now() - lastPing >= 15_000) {
            await stream.write(': ping\n\n');
            lastPing = Date.now();
            if (Date.now() % 60_000 < 15_000) {
              await stream.writeSSE({
                id: String(currentId),
                event: 'heartbeat',
                data: JSON.stringify({ eventId: currentId, at: new Date().toISOString() }),
              });
            }
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const event = queue.shift()!;
        if (event.id <= lastId) continue;
        await writeEvent(event);
        lastId = event.id;
      }
    } catch (error) {
      log.warn({ err: error, wallet, orderId }, 'SSE stream closed');
    } finally {
      clearInterval(heartbeat);
      unsubscribe();
      connectionsByIp.set(ip, Math.max(0, (connectionsByIp.get(ip) ?? 1) - 1));
      decSseClients();
      await stream.close().catch(() => undefined);
    }
  });
});

