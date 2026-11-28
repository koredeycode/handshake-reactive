import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { backgroundDb as db, closeDb } from './client.js';
import { log } from '../lib/log.js';

async function main(): Promise<void> {
  const folder = resolve(process.cwd(), 'migrations');
  log.info({ folder }, 'applying migrations');
  await migrate(db, { migrationsFolder: folder });
  log.info('migrations applied');
  await closeDb();
}

main().catch(async (error) => {
  log.error({ err: error }, 'migration failed');
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
