import { isRetryable, RateLimitedError } from './errors.js';
import { backoffMs } from './queue.js';

export interface RetryOptions {
  readonly attempts?: number;
  readonly baseMs?: number;
  readonly capMs?: number;
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  readonly signal?: AbortSignal;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Retry only what is genuinely retryable.
 *
 * A parse failure is never retried — the county's HTML did not change in the
 * 4 seconds since the last attempt, and retrying just multiplies load on a
 * public server. Only network faults and explicit rate limits back off.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryable(error)) throw error;
      const delay =
        error instanceof RateLimitedError && error.retryAfterMs != null
          ? error.retryAfterMs
          : backoffMs(attempt, options.baseMs, options.capMs);
      options.onRetry?.(error, attempt, delay);
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}
