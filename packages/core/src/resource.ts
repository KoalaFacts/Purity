// ---------------------------------------------------------------------------
// resource — first-class async data with cancellation, race-safety, retry,
// polling, and signal-native loading/error state.
//
// Three forms:
//   resource(fetcher, options?)                  // auto-tracked deps
//   resource(source, fetcher, options?)          // explicit source key
//   lazyResource(fetcher, options?)              // imperative; r.fetch(args)
//
// The fetcher receives an AbortSignal that fires when a newer fetch starts
// or the surrounding component unmounts. Stale resolutions are dropped via
// a monotonic run counter so out-of-order responses can never overwrite
// fresher data. data() is preserved across refetches (SWR by default).
// ---------------------------------------------------------------------------

import { batch, state, watch } from './signals.ts';

export interface ResourceFetchInfo {
  signal: AbortSignal;
}

/** Per-attempt delay function. Receives 0-indexed attempt number. */
export type RetryDelay = (attempt: number) => number;

export interface ResourceRetryOptions {
  /** Number of retries after the initial attempt (default 0). */
  count: number;
  /**
   * Delay between attempts in ms. Default: exponential backoff capped at
   * 30s — `attempt => Math.min(2 ** attempt * 200, 30_000)`.
   */
  delay?: RetryDelay;
}

export interface ResourceOptions<T> {
  /** Seed value before the first fetch resolves. */
  initialValue?: T;
  /**
   * Retry on rejection. `number` enables exponential backoff with that many
   * retries; pass an object for a custom delay.
   */
  retry?: number | ResourceRetryOptions;
  /**
   * Auto-refresh every N ms. Polling re-runs the fetcher with the current
   * deps; the timer is rescheduled after each settle (success or error) and
   * cleared on dispose, mutate, or manual refresh.
   */
  pollInterval?: number;
}

/**
 * Reactive async resource accessor.
 *
 * @example
 * ```ts
 * const user = resource(
 *   () => id(),
 *   (id, { signal }) => fetch(`/u/${id}`, { signal }).then(r => r.json()),
 *   { retry: 3, pollInterval: 60_000 },
 * );
 * ```
 */
export interface ResourceAccessor<T> {
  /** Current data (tracked). undefined until the first fetch resolves. */
  (): T | undefined;
  get(): T | undefined;
  peek(): T | undefined;
  /** True while a fetch is in flight (tracked). */
  loading(): boolean;
  /** Error from the most recent failed fetch, or undefined (tracked). */
  error(): unknown;
  /** Re-run the fetcher with the current dependencies. */
  refresh(): void;
  /** Optimistically set the data and clear any error. */
  mutate(next: T | ((current: T | undefined) => T)): void;
  /**
   * Stop the underlying watcher and abort any in-flight request. Inside a
   * component the watcher auto-disposes on unmount; this is the escape hatch
   * for resources created at module scope or in tests.
   */
  dispose(): void;
}

/**
 * Lazy resource — does not fetch until `r.fetch(args)` is called. Useful for
 * mutations, button-triggered loads, and form submissions.
 */
export interface LazyResourceAccessor<T, A> extends ResourceAccessor<T> {
  /** Trigger the fetcher with the given arguments. */
  fetch(args: A): void;
  /**
   * Re-run the fetcher with the most recent args. No-op if `fetch()` was
   * never called.
   */
  refresh(): void;
}

const DEFAULT_BACKOFF: RetryDelay = (attempt) => Math.min(2 ** attempt * 200, 30_000);

function normalizeRetry(retry: ResourceOptions<unknown>['retry']): ResourceRetryOptions {
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
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `fn` until it succeeds or the retry budget is exhausted. Honors the
 * signal — aborts immediately stop further attempts.
 */
async function withRetry<T>(
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
      const ms = (retry.delay ?? DEFAULT_BACKOFF)(attempt);
      attempt++;
      await abortableSleep(ms, signal);
    }
  }
}

export function resource<T>(
  fetcher: (info: ResourceFetchInfo) => T | Promise<T>,
  options?: ResourceOptions<T>,
): ResourceAccessor<T>;
export function resource<T, K>(
  source: () => K | false | null | undefined,
  fetcher: (key: K, info: ResourceFetchInfo) => T | Promise<T>,
  options?: ResourceOptions<T>,
): ResourceAccessor<T>;
export function resource<T, K>(
  sourceOrFetcher:
    | ((info: ResourceFetchInfo) => T | Promise<T>)
    | (() => K | false | null | undefined),
  fetcherOrOptions?: ((key: K, info: ResourceFetchInfo) => T | Promise<T>) | ResourceOptions<T>,
  maybeOptions?: ResourceOptions<T>,
): ResourceAccessor<T> {
  const hasSource = typeof fetcherOrOptions === 'function';
  const sourceFn = hasSource ? (sourceOrFetcher as () => K | false | null | undefined) : null;
  const fetcher = hasSource
    ? (fetcherOrOptions as (key: K, info: ResourceFetchInfo) => T | Promise<T>)
    : (sourceOrFetcher as (info: ResourceFetchInfo) => T | Promise<T>);
  const options =
    (hasSource ? maybeOptions : (fetcherOrOptions as ResourceOptions<T> | undefined)) ?? {};
  const retry = normalizeRetry(options.retry);
  const pollInterval = options.pollInterval;

  const data = state<T | undefined>(options.initialValue);
  const error = state<unknown>(undefined);
  const loading = state<boolean>(false);
  const refreshTick = state(0);

  let runId = 0;
  let currentController: AbortController | null = null;
  // Manual prev-key dedup so an unrelated state read inside the source
  // function doesn't cause a refetch when the source value is unchanged.
  // (We can't use compute() here because a throw inside compute escapes the
  // watch's CHECK→CLEAN dependency walk before our try/catch could see it.)
  let prevKey: K;
  let hasPrevKey = false;
  let forceNext = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearPoll = () => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const schedulePoll = () => {
    clearPoll();
    if (pollInterval == null || disposed) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      // refresh(): bumps refreshTick so the watch re-runs with forceNext.
      forceNext = true;
      refreshTick((v) => v + 1);
    }, pollInterval);
  };

  const dispose = watch(() => {
    refreshTick();
    const wantsForce = forceNext;
    forceNext = false;

    let key: K | undefined;
    if (sourceFn !== null) {
      let k: K | false | null | undefined;
      try {
        k = sourceFn();
      } catch (err) {
        // Surface source-function errors via error() instead of letting them
        // escape as uncaught microtask exceptions out of the watch flush.
        // Reset the dedup so a later same-key emission re-attempts the fetch
        // instead of being silently skipped (which would freeze error() set).
        hasPrevKey = false;
        clearPoll();
        batch(() => {
          error(err);
          loading(false);
        });
        return;
      }
      if (k === false || k === null || k === undefined) {
        hasPrevKey = false;
        currentController = null;
        clearPoll();
        loading(false);
        return;
      }
      if (!wantsForce && hasPrevKey && Object.is(prevKey, k)) {
        // Source value unchanged and not a forced refresh — skip refetch.
        return;
      }
      prevKey = k;
      hasPrevKey = true;
      key = k;
    }

    const myRun = ++runId;
    const ac = new AbortController();
    currentController = ac;
    clearPoll();

    const callFetcher = (): T | Promise<T> =>
      sourceFn !== null
        ? (fetcher as (key: K, info: ResourceFetchInfo) => T | Promise<T>)(key as K, {
            signal: ac.signal,
          })
        : (fetcher as (info: ResourceFetchInfo) => T | Promise<T>)({
            signal: ac.signal,
          });

    let result: T | Promise<T>;
    loading(true);
    try {
      result = retry.count > 0 ? withRetry(callFetcher, ac.signal, retry) : callFetcher();
    } catch (err) {
      batch(() => {
        error(err);
        loading(false);
      });
      schedulePoll();
      return () => ac.abort();
    }

    if (!(result instanceof Promise)) {
      const sync = result;
      batch(() => {
        data(() => sync);
        error(undefined);
        loading(false);
      });
      schedulePoll();
      return () => ac.abort();
    }

    result.then(
      (val) => {
        if (myRun !== runId || ac.signal.aborted) return;
        batch(() => {
          data(() => val);
          error(undefined);
          loading(false);
        });
        schedulePoll();
      },
      (err) => {
        if (myRun !== runId || ac.signal.aborted) return;
        batch(() => {
          error(err);
          loading(false);
        });
        schedulePoll();
      },
    );

    return () => ac.abort();
  });

  const accessor = (() => data()) as ResourceAccessor<T>;
  accessor.get = () => data();
  accessor.peek = () => data.peek();
  accessor.loading = () => loading();
  accessor.error = () => error();
  accessor.refresh = () => {
    forceNext = true;
    clearPoll();
    refreshTick((v) => v + 1);
  };
  accessor.mutate = (next) => {
    // Invalidate any in-flight fetch so a later resolution can't clobber
    // the optimistic value, and abort the underlying request if there is one.
    // Also reset the dedup so the next same-key source emission re-fetches
    // (mutate() is "optimistic" by contract — users expect server reconciliation
    // on the next dep change).
    runId++;
    hasPrevKey = false;
    clearPoll();
    if (currentController !== null) {
      currentController.abort();
      currentController = null;
    }
    batch(() => {
      if (typeof next === 'function') {
        data(next as (current: T | undefined) => T);
      } else {
        const v = next;
        data(() => v as T);
      }
      error(undefined);
      loading(false);
    });
  };
  accessor.dispose = () => {
    disposed = true;
    clearPoll();
    if (currentController !== null) {
      currentController.abort();
      currentController = null;
    }
    // Drop loading so any UI bound to it doesn't stick on a forever spinner
    // when the resource is torn down mid-flight.
    loading(false);
    dispose();
  };

  return accessor;
}

/**
 * Lazy resource — does not fetch on creation. Call `r.fetch(args)` to trigger.
 * Subsequent `r.refresh()` re-runs the fetcher with the most recent args.
 *
 * @example
 * ```ts
 * const save = lazyResource(
 *   (data: SaveArgs, { signal }) =>
 *     fetch('/save', { method: 'POST', body: JSON.stringify(data), signal }),
 * );
 *
 * html`<button @click=${() => save.fetch({ name: 'x' })}>Save</button>`;
 * ```
 */
export function lazyResource<T, A = void>(
  fetcher: (args: A, info: ResourceFetchInfo) => T | Promise<T>,
  options?: ResourceOptions<T>,
): LazyResourceAccessor<T, A> {
  // Wrap args in an object so each fetch() call produces a fresh reference,
  // bypassing the prev-key dedup even if the user calls fetch with identical
  // values back-to-back.
  const argsState = state<{ value: A } | null>(null);
  const r = resource(
    () => argsState(),
    (wrapped, info) => fetcher(wrapped.value, info),
    options,
  ) as LazyResourceAccessor<T, A>;
  r.fetch = (a: A) => {
    argsState({ value: a });
  };
  return r;
}
