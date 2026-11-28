import { serve } from '@hono/node-server';
import { startAlertMonitor, stopAlertMonitor } from './alerts/resend.js';
import { env } from './config.js';
import { bootstrapDatabase, startRetention, stopRetention } from './db/bootstrap.js';
import { closeDb, dbPing, selectPools } from './db/client.js';
import { createApp } from './http.js';
import { startIndexer, stopIndexer } from './indexer/indexer.js';
import { log } from './lib/log.js';
import { startEventLoopMonitor, stopEventLoopMonitor } from './lib/metrics.js';

async function main(): Promise<void> {
  await selectPools();
  const database = await dbPing();
  if (!database) log.error('database unreachable at boot; routes will fail until it recovers');
  await bootstrapDatabase();
  await startIndexer();
  startEventLoopMonitor();
  startAlertMonitor();
  startRetention();

  const server = serve({ fetch: createApp().fetch, hostname: env.HOST, port: env.PORT }, (info) => {
    log.info({ port: info.port, host: env.HOST }, 'handshake-api listening');
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    server.close();
    stopEventLoopMonitor();
    stopAlertMonitor();
    stopRetention();
    await stopIndexer();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  log.fatal({ err: error }, 'startup failed');
  process.exit(1);
});
