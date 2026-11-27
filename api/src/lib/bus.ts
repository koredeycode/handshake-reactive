import type { OutboxPayload, SseEventType } from './events.js';

/** One committed outbox row, ready for typed in-process fan-out. */
export type PublishedEvent = {
  id: number;
  type: SseEventType;
  orderId: string | null;
  wallets: string[];
  payload: OutboxPayload;
  createdAt: Date;
};

/**
 * Kept behind an interface so a future PgNotifyBus can replace it when the API
 * and indexer are split across machines, without touching any consumer.
 */
export interface EventBus {
  publish(events: PublishedEvent[]): void;
  subscribe(listener: (event: PublishedEvent) => void): () => void;
  subscriberCount(): number;
}

export class InProcessBus implements EventBus {
  private readonly listeners = new Set<(event: PublishedEvent) => void>();

  publish(events: PublishedEvent[]): void {
    if (events.length === 0) return;
    // Sorted by the global cursor: one subscriber can never see events out of
    // order even when several transactions commit in the same tick.
    for (const event of [...events].sort((a, b) => a.id - b.id)) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          // A single slow/broken subscriber must not stall the indexer.
          console.error('[bus] listener failed', error);
        }
      }
    }
  }

  subscribe(listener: (event: PublishedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscriberCount(): number {
    return this.listeners.size;
  }
}

export const bus: EventBus = new InProcessBus();
