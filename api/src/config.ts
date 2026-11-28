import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/handshake'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  REACTIVE_RPC: z.string().default('https://lasna-rpc.rnk.dev/'),
  REACTIVE_WS: z.string().default('wss://lasna-rpc.rnk.dev/'),
  BASE_RPC: z.string().default('https://base-sepolia-rpc.publicnode.com'),
  BASE_WS: z.string().default('wss://base-sepolia-rpc.publicnode.com'),
  UNICHAIN_RPC: z.string().default('https://unichain-sepolia-rpc.publicnode.com'),
  // The official Unichain Sepolia WebSocket endpoint requires the /ws suffix.
  UNICHAIN_WS: z.string().default('wss://unichain-sepolia-rpc.publicnode.com'),
  // publicnode has pruned history for old eth_getLogs; Tenderly gateway serves backfill.
  SEPOLIA_RPC: z.string().default('https://sepolia.gateway.tenderly.co'),
  SEPOLIA_WS: z.string().default('wss://ethereum-sepolia-rpc.publicnode.com'),

  RESEND_API_KEY: z.string().optional(),
  OPERATOR_ALERT_EMAIL: z.string().email().optional(),
  ALERT_FROM_EMAIL: z.string().default('Handshake Alerts <alerts@resend.dev>'),

  CORS_ORIGINS: z.string().default(''),
  MAX_SSE_CONNECTIONS: z.coerce.number().int().positive().default(1000),
  MAX_SSE_PER_IP: z.coerce.number().int().positive().default(10),
  SSE_BUFFER_SIZE: z.coerce.number().int().positive().default(256),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  STALE_EVENT_MS: z.coerce.number().int().positive().default(300_000),
  WALLET_CACHE_TTL_MS: z.coerce.number().int().positive().default(15_000),
  NOTIFICATION_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  ALERT_DEDUPE_MS: z.coerce.number().int().positive().default(600_000),

  /** Optional per-chain starting block for a fresh indexer_state row. */
  START_BLOCK_5318007: z.coerce.number().int().nonnegative().optional(),
  START_BLOCK_84532: z.coerce.number().int().nonnegative().optional(),
  START_BLOCK_1301: z.coerce.number().int().nonnegative().optional(),
  START_BLOCK_11155111: z.coerce.number().int().nonnegative().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export function wsUrlFor(chainId: number): string {
  switch (chainId) {
    case 5318007: return env.REACTIVE_WS;
    case 84532: return env.BASE_WS;
    case 1301: return env.UNICHAIN_WS;
    case 11155111: return env.SEPOLIA_WS;
    default: throw new Error(`No WebSocket URL for chain ${chainId}`);
  }
}

export function httpUrlFor(chainId: number): string {
  switch (chainId) {
    case 5318007: return env.REACTIVE_RPC;
    case 84532: return env.BASE_RPC;
    case 1301: return env.UNICHAIN_RPC;
    case 11155111: return env.SEPOLIA_RPC;
    default: throw new Error(`No HTTP URL for chain ${chainId}`);
  }
}

/** CORS: explicit allowlist plus every *.vercel.app preview/production domain. */
export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return false;
    const configured = env.CORS_ORIGINS.split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const host = url.hostname.toLowerCase();
    if (configured.includes(origin.replace(/\/$/, '').toLowerCase()) || configured.includes(host)) return true;
    if (host === 'vercel.app' || host.endsWith('.vercel.app')) return true;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}
