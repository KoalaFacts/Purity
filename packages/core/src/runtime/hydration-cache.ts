// ---------------------------------------------------------------------------
// Client-side hydration cache — primed by `hydrate()` from the
// `<script id="__purity_resources__">` tag emitted by renderToString.
// ---------------------------------------------------------------------------

import { setHydrationCacheConsumer } from '../hooks.ts';

let hydrationCache: unknown[] | null = null;
let hydrationCursor = 0;
let hydrationCacheByKey: Record<string, unknown> | null = null;

/**
 * Consume the next positional value, or — if `key` is supplied and present
 * in the keyed cache — return that. Returns `undefined` on miss; the
 * caller falls back to fetching normally.
 *
 * @internal
 */
export function consumeHydrationValue(key?: string): unknown {
  if (key !== undefined) {
    if (hydrationCacheByKey && key in hydrationCacheByKey) {
      return hydrationCacheByKey[key];
    }
    return undefined;
  }
  if (!hydrationCache || hydrationCursor >= hydrationCache.length) return undefined;
  return hydrationCache[hydrationCursor++];
}

/**
 * Accept the legacy array shape (`[v0, v1, …]`) or the object shape
 * (`{ ordered: [...], keyed: {...} }`).
 *
 * @internal
 */
export function primeHydrationCache(data: unknown): void {
  setHydrationCacheConsumer(consumeHydrationValue);
  hydrationCursor = 0;
  if (Array.isArray(data)) {
    hydrationCache = data;
    hydrationCacheByKey = null;
    return;
  }
  if (data && typeof data === 'object') {
    const obj = data as { ordered?: unknown; keyed?: unknown };
    hydrationCache = Array.isArray(obj.ordered) ? obj.ordered : [];
    hydrationCacheByKey =
      obj.keyed && typeof obj.keyed === 'object'
        ? (Object.assign(Object.create(null), obj.keyed) as Record<string, unknown>)
        : null;
    return;
  }
  hydrationCache = null;
  hydrationCacheByKey = null;
}

/** @internal Capture module-global resource hydration state before a root attempts adoption. */
export function checkpointHydrationCache(): () => void {
  const values = hydrationCache;
  const cursor = hydrationCursor;
  const keyed = hydrationCacheByKey;
  return () => {
    hydrationCache = values;
    hydrationCursor = cursor;
    hydrationCacheByKey = keyed;
  };
}

/** @internal */
export function clearHydrationCache(): void {
  hydrationCache = null;
  hydrationCursor = 0;
  hydrationCacheByKey = null;
}
