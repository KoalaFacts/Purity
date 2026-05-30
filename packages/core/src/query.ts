// ---------------------------------------------------------------------------
// query(options) — stale-while-revalidate over resource(). ADR 0048.
//
// Module-level cache keyed by serialized cache key. Same key = shared
// resource = shared in-flight + shared data across components.
//
// Three revalidation triggers wire lazily on first call:
//   - pageVisibilitySignal: refresh on visible (per-entry opt-out)
//   - onlineSignal: refresh on online (per-entry opt-out)
//   - bfcacheRestoreSignal: refresh on bfcache restore (per-entry opt-out)
//
// `staleTime` is a trigger debounce — entries younger than staleTime ms
// since their last successful fetch skip the next trigger. Reads always
// return the cached value immediately.
//
// Returns a ResourceAccessor<T> — drop-in for code that already uses
// `resource()`. invalidateQuery(key) busts a single entry and refreshes.
// ---------------------------------------------------------------------------

import { bfcacheRestoreSignal } from './bfcache-restore-signal.ts';
import { onlineSignal } from './online-signal.ts';
import { pageVisibilitySignal } from './page-visibility-signal.ts';
import { resource, type ResourceAccessor, type ResourceFetchInfo } from './resource.ts';
import { watch, type Dispose } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/** Cache key for query(). Strings are used as-is; arrays are JSON-serialized. */
export type QueryKey = string | readonly unknown[];

export interface QueryOptions<T> {
  /** Cache key. Same key = shared in-flight + shared data. */
  key: QueryKey;
  /** Fetcher. Called with the key and an abort-aware info object. */
  fetcher: (key: QueryKey, info: ResourceFetchInfo) => T | Promise<T>;
  /** Initial value before the first fetch resolves. */
  initialValue?: T;
  /** ms; entries younger than this skip revalidation triggers. Default 0. */
  staleTime?: number;
  /** Revalidate when the page becomes visible. Default true. */
  revalidateOnVisible?: boolean;
  /** Revalidate when the browser reports back online. Default true. */
  revalidateOnReconnect?: boolean;
  /** Revalidate on bfcache restore. Default true. */
  revalidateOnBfcacheRestore?: boolean;
}

interface QueryEntry<T = unknown> {
  resource: ResourceAccessor<T>;
  lastFetchedAt: number;
  staleTime: number;
  revalidateOnVisible: boolean;
  revalidateOnReconnect: boolean;
  revalidateOnBfcacheRestore: boolean;
}

const cache: Map<string, QueryEntry<unknown>> = new Map();
let triggersWired = false;
// Captured so _resetQueryCache() can dispose them — without this, every
// reset (test runs, HMR) leaves the old watches ticking on the lifecycle
// signals and the next wire registers three fresh ones. Compounding leak.
let triggerDisposes: Dispose[] = [];

/** Serialize a QueryKey to a stable cache string.
 *
 * Bug A — String vs array-key collision. Without a discriminator,
 * `query({ key: '["x"]' })` and `query({ key: ['x'] })` both serialize to
 * `'["x"]'` and share a cache entry — one user's string key silently
 * hijacks another user's array key (and vice versa). Prefix each variant
 * with a 1-char tag so the two namespaces can never collide. */
function serializeKey(k: QueryKey): string {
  return typeof k === 'string' ? `s:${k}` : `a:${JSON.stringify(k)}`;
}

/** Refresh every cache entry whose trigger matches and whose stale window has elapsed. */
function refreshMatching(
  triggerKey: keyof Pick<
    QueryEntry,
    'revalidateOnVisible' | 'revalidateOnReconnect' | 'revalidateOnBfcacheRestore'
  >,
): void {
  const now = Date.now();
  for (const entry of cache.values()) {
    if (!entry[triggerKey]) continue;
    if (now - entry.lastFetchedAt < entry.staleTime) continue;
    // Isolate: one resource.refresh() throw must not skip revalidation
    // for every other matching query in the same lifecycle event.
    try {
      entry.resource.refresh();
    } catch (err) {
      console.error('[purity] query refresh threw during lifecycle trigger:', err);
    }
  }
}

function wireRevalidationTriggers(): void {
  if (triggersWired) return;
  if (getSSRRenderContext() !== null || typeof window === 'undefined') return;
  triggersWired = true;

  const visible = pageVisibilitySignal();
  const online = onlineSignal();
  const bfcache = bfcacheRestoreSignal();

  triggerDisposes.push(
    watch(visible, (v, prev) => {
      if (v === 'visible' && prev !== 'visible') refreshMatching('revalidateOnVisible');
    }),
    watch(online, (v, prev) => {
      if (v === true && prev === false) refreshMatching('revalidateOnReconnect');
    }),
    watch(bfcache, () => {
      refreshMatching('revalidateOnBfcacheRestore');
    }),
  );
}

/** Wrap the user fetcher so each successful settle stamps `lastFetchedAt`.
 *
 * Bug B — Stale-resolution stamp leak. Without the abort gate, a slow
 * fetch that was superseded (by `refresh()`, `invalidateQuery`, or a
 * source-key change) still runs its `.then()` when it eventually
 * resolves, stamping `lastFetchedAt = Date.now()`. That stamp poisons
 * staleTime in two ways:
 *   (1) Concurrent fetches — if fetch A (slow) starts first, fetch B
 *       (fast) supersedes it and stamps, then A resolves last and
 *       overwrites the stamp with a wall-clock-newer-but-data-staler
 *       timestamp. Subsequent triggers think the entry is fresh when
 *       it really holds fetch B's data, still bounded by A's older
 *       request time.
 *   (2) Invalidate-while-loading — `invalidateQuery` zeroes
 *       `lastFetchedAt` to force the next trigger to revalidate, then
 *       the in-flight fetch's `.then()` lands and re-stamps it to
 *       "now", silently undoing the invalidation.
 * Resource() already drops stale resolutions via `myRun !== runId ||
 * ac.signal.aborted` — gate this stamp on the same abort signal so a
 * superseded fetch is a no-op all the way through.
 *
 * The wrapper also has to swallow rejections-after-abort. Without this,
 * `fetch()` calls that lose their race throw `AbortError` from the
 * fetcher (or from a slow user fetcher that misses its own signal) and
 * resource() sees a rejected promise from a run it already wrote off —
 * surfacing as `error()` on the accessor or as an
 * unhandledRejection if the resource has already swapped out. */
function makeStampedFetcher<T>(
  options: QueryOptions<T>,
  keyStr: string,
): (info: ResourceFetchInfo) => T | Promise<T> {
  return (info: ResourceFetchInfo) => {
    const result = options.fetcher(options.key, info);
    const stampIfFresh = (): void => {
      // Superseded fetches must not move the freshness stamp forward.
      if (info.signal.aborted) return;
      const e = cache.get(keyStr);
      if (e) e.lastFetchedAt = Date.now();
    };
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).then(
        (value) => {
          stampIfFresh();
          return value;
        },
        (err) => {
          // Don't stamp on failure — fetch produced no fresh data.
          // Re-throw so resource() can surface the error via .error().
          throw err;
        },
      );
    }
    stampIfFresh();
    return result;
  };
}

/**
 * Stale-while-revalidate query over `resource()` (ADR 0048).
 *
 * Module-level cache: same `key` = shared in-flight request, shared
 * cached value, shared error state across components.
 *
 * @example
 * ```ts
 * const user = query({
 *   key: ['user', 42],
 *   fetcher: (key, { signal }) =>
 *     fetch(`/api/users/${(key as ['user', number])[1]}`, { signal }).then((r) => r.json()),
 *   staleTime: 5_000,
 * });
 *
 * watch(user, (data) => {
 *   if (data) console.log('user:', data);
 * });
 * ```
 */
export function query<T>(options: QueryOptions<T>): ResourceAccessor<T> {
  const keyStr = serializeKey(options.key);

  // SSR: bypass the module-level cache. That Map is process-global and
  // persists across requests — sharing a cached entry between two SSR
  // renders would leak one request's data into another. Delegate straight
  // to resource(), whose own per-SSRRenderContext cache (keyed by `key`)
  // handles dedup within a single render and pairs the resolved value to
  // the client for hydration.
  if (getSSRRenderContext() !== null) {
    return resource((info) => options.fetcher(options.key, info), {
      initialValue: options.initialValue,
      key: keyStr,
    });
  }

  const existing = cache.get(keyStr);
  if (existing) {
    warnOnConfigMismatch(keyStr, options, existing);
    return existing.resource as ResourceAccessor<T>;
  }

  const entry: QueryEntry<T> = {
    resource: undefined as unknown as ResourceAccessor<T>, // patched below
    lastFetchedAt: 0,
    staleTime: options.staleTime ?? 0,
    revalidateOnVisible: options.revalidateOnVisible ?? true,
    revalidateOnReconnect: options.revalidateOnReconnect ?? true,
    revalidateOnBfcacheRestore: options.revalidateOnBfcacheRestore ?? true,
  };
  cache.set(keyStr, entry as QueryEntry<unknown>);

  entry.resource = resource(makeStampedFetcher(options, keyStr), {
    initialValue: options.initialValue,
    key: keyStr,
  });

  wireRevalidationTriggers();
  return entry.resource;
}

/** Imperatively invalidate a cache entry and refresh it. No-op if absent. */
export function invalidateQuery(key: QueryKey): void {
  const entry = cache.get(serializeKey(key));
  if (!entry) return;
  entry.lastFetchedAt = 0;
  entry.resource.refresh();
}

function warnOnConfigMismatch<T>(
  keyStr: string,
  next: QueryOptions<T>,
  existing: QueryEntry<unknown>,
): void {
  const cases: [string, unknown, unknown][] = [
    ['staleTime', next.staleTime ?? 0, existing.staleTime],
    ['revalidateOnVisible', next.revalidateOnVisible ?? true, existing.revalidateOnVisible],
    ['revalidateOnReconnect', next.revalidateOnReconnect ?? true, existing.revalidateOnReconnect],
    [
      'revalidateOnBfcacheRestore',
      next.revalidateOnBfcacheRestore ?? true,
      existing.revalidateOnBfcacheRestore,
    ],
  ];
  for (const [name, n, e] of cases) {
    if (!Object.is(n, e)) {
      // Strip the internal namespace prefix (`s:` for strings, `a:` for
      // arrays — see Bug A in serializeKey) before surfacing to the user.
      // Both prefixes are 2 chars wide, so a single slice handles both.
      const displayKey = keyStr.slice(2);
      console.warn(
        `[purity] query('${displayKey}') called again with a different ${name}; the first call's value wins.`,
      );
      return;
    }
  }
}

/** @internal — test helper. Disposes the trigger watches, clears the
 * cache + every cached resource, and un-arms the trigger wiring so a
 * subsequent client call re-arms a fresh, single set of watches. */
export function _resetQueryCache(): void {
  // Isolate each teardown — one throw can't strand the rest. Test runs
  // and HMR rely on _reset being a "burn it down" path; partial cleanup
  // poisons subsequent tests.
  for (const dispose of triggerDisposes) {
    try {
      dispose();
    } catch (err) {
      console.error('[purity] _resetQueryCache: trigger-watch dispose threw:', err);
    }
  }
  triggerDisposes = [];
  for (const entry of cache.values()) {
    try {
      entry.resource.dispose();
    } catch (err) {
      console.error('[purity] _resetQueryCache: resource dispose threw:', err);
    }
  }
  cache.clear();
  triggersWired = false;
}
