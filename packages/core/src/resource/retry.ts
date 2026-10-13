import type { ResourceOptions, ResourceRetryOptions, RetryDelay } from '../resource.ts';

const abortError = () => new DOMException('aborted', 'AbortError');

const DEFAULT_BACKOFF: RetryDelay = (attempt) => Math.min(2 ** attempt * 200, 30_000);

export function normalizeRetry(retry: ResourceOptions<unknown>['retry']): ResourceRetryOptions {
  if (retry == null) return { count: 0, delay: DEFAULT_BACKOFF };
  if (typeof retry === 'number') return { count: retry, delay: DEFAULT_BACKOFF };
  return { count: retry.count, delay: retry.delay ?? DEFAULT_BACKOFF };
}

/**
 * Sleep for `ms`, rejecting with an AbortError if the signal aborts first.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `fn` until it succeeds or the retry budget is exhausted. Honors the
 * signal — aborts immediately stop further attempts.
 */
export async function withRetry<T>(
  fn: () => T | Promise<T>,
  signal: AbortSignal,
  retry: ResourceRetryOptions,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted || attempt >= retry.count) throw err;
      // Sanitize the user-supplied delay: a `delay` that returns NaN,
      // Infinity, or a negative number would otherwise reach setTimeout,
      // which coerces those to ~0 and turns the retry into a tight loop that
      // hammers the server. Clamp to a finite, non-negative ms.
      const raw = (retry.delay ?? DEFAULT_BACKOFF)(attempt);
      const ms = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      attempt++;
      await abortableSleep(ms, signal);
    }
  }
}
