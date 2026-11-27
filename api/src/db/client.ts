import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { env } from '../config.js';
import { log } from '../lib/log.js';
import { metrics } from '../lib/metrics.js';
import * as schema from './schema.js';

/** `prepare: false` keeps the pooler (Supabase transaction mode) happy. */
export const pg = postgres(env.DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  onnotice: () => undefined,
});

export const db = drizzle(pg, { schema });

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
  await pg.end({ timeout: 5 });
}
