// ---------------------------------------------------------------------------
// resource — first-class async data with cancellation, race-safety, and
// signal-native loading/error state.
//
// Two forms:
//   resource(fetcher, options?)
//   resource(source, fetcher, options?)
//
// The fetcher receives an AbortSignal that fires when a newer fetch starts
// or the surrounding component unmounts. Stale resolutions are dropped via
// a monotonic run counter so out-of-order responses can never overwrite
// fresher data.
// ---------------------------------------------------------------------------

import { batch, state, watch } from './signals.ts';

export interface ResourceFetchInfo {
  signal: AbortSignal;
}

/**
 * Reactive async resource accessor.
 *
 * @example
 * ```ts
 * const user = resource(
 *   () => id(),
 *   (id, { signal }) => fetch(`/u/${id}`, { signal }).then(r => r.json()),
 * );
 *
 * html`
 *   ${() => user.loading() ? 'loading…' : null}
 *   ${() => user.error()   ? `error: ${user.error()}` : null}
 *   ${() => user()?.name}
 * `;
 *
 * user.refresh();        // re-run with current deps
 * user.mutate({ ... });  // optimistic update
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

export interface ResourceOptions<T> {
  /** Seed value before the first fetch resolves. */
  initialValue?: T;
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
        batch(() => {
          error(err);
          loading(false);
        });
        return;
      }
      if (k === false || k === null || k === undefined) {
        hasPrevKey = false;
        currentController = null;
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

    let result: T | Promise<T>;
    loading(true);
    try {
      // The two overloads union into a callable whose first param TS narrows
      // to `K & ResourceFetchInfo`; cast at the call site to disambiguate.
      result =
        sourceFn !== null
          ? (fetcher as (key: K, info: ResourceFetchInfo) => T | Promise<T>)(key as K, {
              signal: ac.signal,
            })
          : (fetcher as (info: ResourceFetchInfo) => T | Promise<T>)({
              signal: ac.signal,
            });
    } catch (err) {
      batch(() => {
        error(err);
        loading(false);
      });
      return () => ac.abort();
    }

    if (!(result instanceof Promise)) {
      const sync = result;
      batch(() => {
        data(() => sync);
        error(undefined);
        loading(false);
      });
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
      },
      (err) => {
        if (myRun !== runId || ac.signal.aborted) return;
        batch(() => {
          error(err);
          loading(false);
        });
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
