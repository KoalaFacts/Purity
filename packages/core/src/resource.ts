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

import { bindComponentState } from './component.ts';
import { batch, state, watch } from './signals.ts';
import { consumeHydrationValue, getSSRRenderContext } from './ssr-context.ts';
import { ssrResources } from './resource/dispatch.ts';
import { normalizeRetry, withRetry } from './resource/retry.ts';

export interface ResourceFetchInfo {
  /** Cancels on client disposal/refetch or SSR request/render cancellation. */
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
  /**
   * Stable cache key for SSR ↔ hydration lookups. Without one, the
   * server/client cache pairs each `resource()` by creation order — which
   * shifts whenever a conditional resource skips a render. Provide a key
   * (any unique-per-render string) for any resource that isn't
   * unconditionally created, and the hydration cache will match by name
   * instead of position.
   */
  key?: string;
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
  // Treat a non-positive or non-finite pollInterval as "polling disabled".
  // `pollInterval: 0` would otherwise `setTimeout(..., 0)` after every settle
  // and re-fire the fetcher immediately — a runaway hot loop. `null` is the
  // canonical "off" sentinel that `schedulePoll` already short-circuits on.
  const rawPoll = options.pollInterval;
  const pollInterval = rawPoll != null && Number.isFinite(rawPoll) && rawPoll > 0 ? rawPoll : null;

  // Client-side: if hydrate() primed a cache, consume the next value as the
  // initial data and skip the FIRST watch-driven fetch. This avoids the brief
  // loading flash that would otherwise refetch every server-rendered
  // resource on hydrate. The watch still fires later when source-key deps
  // change, so reactivity is intact.
  //
  // When the user provided a stable `key`, look up by that name instead of
  // by creation-order — robust to conditional resource creation between
  // server and client.
  const userKey = options.key;
  const hydrationValue = consumeHydrationValue(userKey);
  const hasHydrationValue = hydrationValue !== undefined;
  let skipFirstFetch = hasHydrationValue;

  const data = state<T | undefined>(
    hasHydrationValue ? (hydrationValue as T) : options.initialValue,
  );
  const error = state<unknown>(undefined);
  const loading = state<boolean>(false);
  const refreshTick = state(0);

  let runId = 0;
  let currentController: AbortController | null = null;
  // Manual prev-key dedup. compute() can't be used: a throw inside compute
  // escapes the watch's CHECK→CLEAN dependency walk before any try/catch
  // around the read could see it.
  let prevKey: K;
  let hasPrevKey = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPoll = () => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const cancelInFlight = () => {
    clearPoll();
    if (currentController !== null) {
      currentController.abort();
      currentController = null;
    }
  };

  const schedulePoll = () => {
    if (pollInterval == null) return;
    clearPoll();
    pollTimer = setTimeout(() => {
      pollTimer = null;
      hasPrevKey = false;
      refreshTick((v) => v + 1);
    }, pollInterval);
  };

  // SSR path: bypass watch entirely. Two-pass render — first pass fires the
  // fetcher and registers the promise on the active SSRRenderContext; second
  // pass consumes the resolved value from `ctx.resolvedData`. The watch is
  // reactive and DOM-bound, neither of which applies on the server.
  const ssrCtx = getSSRRenderContext();
  if (ssrCtx) {
    return ssrResources.resource(ssrCtx, userKey, sourceFn, fetcher, retry, data, error, loading);
  }

  const dispose = watch(() => {
    refreshTick();
    if (skipFirstFetch) {
      // Hydration: cached value already in `data`; skip the first fetcher
      // run. Source-key changes after hydrate continue to fetch normally.
      skipFirstFetch = false;
      // Track refreshTick / sourceFn deps so subsequent invalidations re-fire.
      if (sourceFn !== null) {
        try {
          sourceFn();
        } catch {
          // Errors during dep tracking are surfaced on the next real run.
        }
      }
      return;
    }

    let key: K | undefined;
    if (sourceFn !== null) {
      let k: K | false | null | undefined;
      try {
        k = sourceFn();
      } catch (err) {
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
        if (currentController !== null) currentController = null;
        clearPoll();
        loading(false);
        return;
      }
      if (hasPrevKey && Object.is(prevKey, k)) return;
      prevKey = k;
      hasPrevKey = true;
      key = k;
    }

    const myRun = ++runId;
    const ac = new AbortController();
    currentController = ac;
    clearPoll();
    const cleanup = () => ac.abort();

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
      return cleanup;
    }

    if (!(result instanceof Promise)) {
      const sync = result;
      batch(() => {
        data(() => sync);
        error(undefined);
        loading(false);
      });
      schedulePoll();
      return cleanup;
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

    return cleanup;
  });

  const accessor = data.get as ResourceAccessor<T>;
  accessor.get = data.get;
  accessor.peek = data.peek;
  accessor.loading = loading.get;
  accessor.error = error.get;
  accessor.refresh = () => {
    hasPrevKey = false;
    clearPoll();
    refreshTick((v) => v + 1);
  };
  accessor.mutate = (next) => {
    // mutate() is optimistic: invalidate any in-flight fetch and clear the
    // dedup so the next same-key source emission re-fetches for reconciliation.
    runId++;
    hasPrevKey = false;
    cancelInFlight();
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
    cancelInFlight();
    hasPrevKey = false;
    // Drop loading so UI bound to it doesn't stick on a forever spinner.
    loading(false);
    dispose();
  };

  // Auto-expose the resource's lifecycle as CSS custom states on the
  // surrounding component's host element. No-op outside a component() or
  // when `ElementInternals.states` is unavailable. Multiple resources
  // compose via bindComponentState()'s ref-counting — the host is
  // `:state(loading)` if *any* resource is loading.
  bindComponentState('loading', loading.get);
  bindComponentState('error', () => error.get() !== undefined);

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
  const userKey = options?.key;
  r.fetch = (a: A) => {
    // SSR multipass registration (ADR 0024). When `.fetch()` runs inside a
    // server render pass, the argsState/watch plumbing fires too late —
    // the renderer awaits `pendingPromises` and returns before the queued
    // microtask runs the underlying resource()'s fetch. Bypass argsState
    // entirely on the server: fire the fetcher synchronously, push the
    // promise onto `ssrCtx.pendingPromises`, and cache the resolved value
    // in `ssrCtx.resolvedDataByKey` keyed by the user-supplied `key`.
    //
    // Requires `key` — positional indices collide with the inner
    // resource()'s own counter slot. Without a key the SSR pass falls
    // through to the client-only argsState path (i.e. the existing
    // broken-on-server behavior); apps that want SSR support opt in via
    // the key option.
    const ssrCtx = getSSRRenderContext();
    if (ssrCtx && userKey !== undefined) {
      ssrResources.fetchLazy(ssrCtx, userKey, r, fetcher, a);
      return;
    }
    argsState({ value: a });
  };
  return r;
}
