import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { env } from '../config.js';
import { log } from '../lib/log.js';
import { metrics } from '../lib/metrics.js';
import * as schema from './schema.js';

/**
 * Three isolated pools. A silent Supabase query on one workload must never
 * starve an unrelated one — that was the cause of the 7h hang and the 5xx
 * bursts (request queries timing out behind indexer/alert work).
 *
 * `prepare: false` keeps the pooler (Supabase transaction mode) happy.
 */
function makePool(name: string, max: number, queryTimeout: number, queueTimeout: number) {
  return postgres(env.DATABASE_URL, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    query_timeout: queryTimeout,
    queue_timeout: queueTimeout,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: `handshake-api-${name}` },
  });
}

/** User-facing REST/SSE reads. Short timeouts: fail fast, never hang a client. */
export const requestPg = makePool('request', 4, 15, 5);
/** Indexer writes, gap backfill, retention, bootstrap. Bounded so a Supabase
 *  stall cannot pin these connections for minutes. */
export const backgroundPg = makePool('background', 2, 30, 10);
/** Operator alert dedupe writes. Own pool so a 5xx cannot amplify itself. */
export const alertPg = makePool('alerts', 2, 10, 5);

export const db = drizzle(requestPg, { schema });
export const backgroundDb = drizzle(backgroundPg, { schema });
export const alertDb = drizzle(alertPg, { schema });

/** Kept as an alias for callers that still reference the raw request pool. */
export const pg = requestPg;

export async function dbPing(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (error) {
    metrics.dbFailures.inc();
    log.error({ err: error }, 'database ping failed');
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await Promise.allSettled([
    requestPg.end({ timeout: 5 }),
    backgroundPg.end({ timeout: 5 }),
    alertPg.end({ timeout: 5 }),
  ]);
}
