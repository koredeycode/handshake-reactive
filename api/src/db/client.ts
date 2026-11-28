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
 * `prepare: false` keeps the transaction pooler happy.
 */
function makePool(name: string, max: number, queryTimeout: number, queueTimeout: number, url = env.DATABASE_URL) {
  return postgres(url, {
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

/** Supabase free-tier transaction pooler periodically stops answering. The
 *  direct host is the same database without that proxy; derive it from the
 *  pooler URL so no new credential is needed. */
function directUrlFromPooler(urlString: string): string | undefined {
  try {
    const u = new URL(urlString);
    if (!u.hostname.includes('pooler.supabase.com')) return undefined;
    const projectRef = u.username.split('.')[1];
    if (!projectRef) return undefined;
    u.hostname = `db.${projectRef}.supabase.co`;
    u.port = '5432';
    u.username = 'postgres';
    return u.toString();
  } catch {
    return undefined;
  }
}

const directUrl = directUrlFromPooler(env.DATABASE_URL);

/** All pools start on the transaction pooler and are upgraded to the direct
 *  host at boot if it answers. Live ESM bindings mean importers see the switch. */
const requestFallbackPg = makePool('request', 4, 15, 5);
const backgroundFallbackPg = makePool('background', 2, 10, 5);
const alertFallbackPg = makePool('alerts', 2, 10, 5);
const directRequestPg = directUrl ? makePool('request-direct', 4, 15, 5, directUrl) : undefined;
const directBackgroundPg = directUrl ? makePool('background-direct', 2, 10, 5, directUrl) : undefined;
const directAlertPg = directUrl ? makePool('alerts-direct', 2, 10, 5, directUrl) : undefined;

export let requestPg = requestFallbackPg;
export let backgroundPg = backgroundFallbackPg;
export let alertPg = alertFallbackPg;
export let db = drizzle(requestPg, { schema });
export let backgroundDb = drizzle(backgroundPg, { schema });
export let alertDb = drizzle(alertPg, { schema });

/** Probe once at boot. Direct connections avoid the Supavisor stall; if they
 *  are unavailable (network policy, connection limit), stay on the pooler. */
export async function selectPools(): Promise<void> {
  if (!directRequestPg || !directBackgroundPg || !directAlertPg) return;
  try {
    await directRequestPg`select 1`;
    requestPg = directRequestPg;
    backgroundPg = directBackgroundPg;
    alertPg = directAlertPg;
    db = drizzle(requestPg, { schema });
    backgroundDb = drizzle(backgroundPg, { schema });
    alertDb = drizzle(alertPg, { schema });
    pg = requestPg;
    log.info({ mode: 'direct' }, 'all database pools using direct Supabase connection');
  } catch (error) {
    log.warn({ err: error, mode: 'pooler' }, 'direct Supabase unavailable; keeping transaction pooler');
  }
}

/** Kept as an alias for callers that still reference the raw request pool. */
export let pg = requestPg;

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
    requestFallbackPg.end({ timeout: 5 }),
    backgroundFallbackPg.end({ timeout: 5 }),
    alertFallbackPg.end({ timeout: 5 }),
    directRequestPg?.end({ timeout: 5 }),
    directBackgroundPg?.end({ timeout: 5 }),
    directAlertPg?.end({ timeout: 5 }),
  ]);
}
