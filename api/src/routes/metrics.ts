import { Hono } from 'hono';
import { metricsText, setOutboxDepthProvider } from '../lib/metrics.js';
import { outboxDepth } from '../indexer/ingest.js';

setOutboxDepthProvider(outboxDepth);

export const metricsRoutes = new Hono();

metricsRoutes.get('/metrics', async (c) => {
  const body = await metricsText();
  c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  c.header('Cache-Control', 'no-store');
  return c.body(body);
});
