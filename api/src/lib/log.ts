import pino from 'pino';
import { env } from '../config.js';

export const log = pino({
  level: env.LOG_LEVEL,
  base: { service: 'handshake-api' },
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function child(fields: Record<string, unknown>) {
  return log.child(fields);
}
