import { CHAIN_CONFIGS } from '../contracts.js';

type ChainStats = {
  status: 'connecting' | 'live' | 'reconnecting' | 'error' | 'gapFillOnly';
  lastEventAt: number;
  lastBlock: number;
  reconnectCount: number;
  subscriptions: number;
};

const stats = new Map<number, ChainStats>(
  CHAIN_CONFIGS.map((chain) => [chain.chainId, {
    status: 'connecting' as const,
    lastEventAt: 0,
    lastBlock: 0,
    reconnectCount: 0,
    subscriptions: 0,
  }]),
);

export const indexerStats = {
  set(chainId: number, patch: Partial<ChainStats>): void {
    const current = stats.get(chainId);
    if (current) stats.set(chainId, { ...current, ...patch });
  },
  get(chainId: number): ChainStats | undefined {
    return stats.get(chainId);
  },
  all(): Array<ChainStats & { chainId: number }> {
    return [...stats.entries()].map(([chainId, value]) => ({ chainId, ...value }));
  },
  maxLastEventAgeMs(): number {
    const now = Date.now();
    let max = 0;
    for (const value of stats.values()) {
      if (value.lastEventAt > 0) max = Math.max(max, now - value.lastEventAt);
    }
    return max;
  },
  totalSubscriptions(): number {
    return [...stats.values()].reduce((sum, value) => sum + value.subscriptions, 0);
  },
};
