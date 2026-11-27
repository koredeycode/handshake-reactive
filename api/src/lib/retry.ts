export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Return true for errors that should halve the batch size instead of retrying. */
  isRangeError?: (error: unknown) => boolean;
};

export class RetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    (error as { code?: number }).code === 429
  );
}

export function backoffDelay(attempt: number, base: number, max: number): number {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 5;
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 15_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || options.isRangeError?.(error)) throw error;
      // 429s are treated exactly like transient transport errors: exponential
      // backoff with jitter, never a hard failure (per plan §5.1).
      const delay = backoffDelay(attempt, base, max);
      options.onRetry?.(error, attempt, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
