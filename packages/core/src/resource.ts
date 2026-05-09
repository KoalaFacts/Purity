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

import { batch, compute, state, watch } from './signals.ts';

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
  // Memoize the source so unrelated upstream changes that produce an equal
  // value don't trigger spurious refetches.
  const sourceMemo = hasSource
    ? compute(sourceOrFetcher as () => K | false | null | undefined)
    : null;
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

  watch(() => {
    refreshTick();

    let key: K | undefined;
    if (sourceMemo !== null) {
      const k = sourceMemo();
      // The watch cleanup from the previous run has already aborted any
      // in-flight controller, so we just need to clear loading here.
      if (k === false || k === null || k === undefined) {
        loading(false);
        return;
      }
      key = k;
    }

    const myRun = ++runId;
    const ac = new AbortController();

    let result: T | Promise<T>;
    loading(true);
    try {
      // The two overloads union into a callable whose first param TS narrows
      // to `K & ResourceFetchInfo`; cast at the call site to disambiguate.
      result =
        sourceMemo !== null
          ? (fetcher as (key: K, info: ResourceFetchInfo) => T | Promise<T>)(
              key as K,
              { signal: ac.signal },
            )
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
    refreshTick((v) => v + 1);
  };
  accessor.mutate = (next) => {
    batch(() => {
      if (typeof next === 'function') {
        data(next as (current: T | undefined) => T);
      } else {
        const v = next;
        data(() => v as T);
      }
      error(undefined);
    });
  };

  return accessor;
}
