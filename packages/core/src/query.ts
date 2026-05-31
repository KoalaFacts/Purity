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
import { watch } from './signals.ts';
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

/** Serialize a QueryKey to a stable cache string. */
function serializeKey(k: QueryKey): string {
  return typeof k === 'string' ? k : JSON.stringify(k);
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
    entry.resource.refresh();
  }
}

function wireRevalidationTriggers(): void {
  if (triggersWired) return;
  if (getSSRRenderContext() !== null || typeof window === 'undefined') return;
  triggersWired = true;

  const visible = pageVisibilitySignal();
  const online = onlineSignal();
  const bfcache = bfcacheRestoreSignal();

  watch(visible, (v, prev) => {
    if (v === 'visible' && prev !== 'visible') refreshMatching('revalidateOnVisible');
  });
  watch(online, (v, prev) => {
    if (v === true && prev === false) refreshMatching('revalidateOnReconnect');
  });
  watch(bfcache, () => {
    refreshMatching('revalidateOnBfcacheRestore');
  });
}

/** Wrap the user fetcher so each successful settle stamps `lastFetchedAt`. */
function makeStampedFetcher<T>(
  options: QueryOptions<T>,
  keyStr: string,
): (info: ResourceFetchInfo) => T | Promise<T> {
  return (info: ResourceFetchInfo) => {
    const result = options.fetcher(options.key, info);
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).then((value) => {
        const e = cache.get(keyStr);
        if (e) e.lastFetchedAt = Date.now();
        return value;
      });
    }
    const e = cache.get(keyStr);
    if (e) e.lastFetchedAt = Date.now();
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
      console.warn(
        `[Purity] query('${keyStr}') called again with a different ${name}; the first call's value wins.`,
      );
      return;
    }
  }
}

/** @internal — test helper. Clears the cache + un-arms the trigger wiring. */
export function _resetQueryCache(): void {
  for (const entry of cache.values()) {
    entry.resource.dispose();
  }
  cache.clear();
  triggersWired = false;
}
