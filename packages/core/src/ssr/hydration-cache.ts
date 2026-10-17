// ---------------------------------------------------------------------------
// Client-side hydration cache — primed by `hydrate()` from the
// `<script id="__purity_resources__">` tag emitted by renderToString.
//
// Two parallel stores:
//   * `hydrationCache` (positional) — consumed in creation order. Used by
//     resources that didn't opt into a stable key. Best-effort: shifts
//     under conditional resource creation (the long-standing limitation
//     called out in ADR 0004).
//   * `hydrationCacheByKey` (keyed) — looked up by the user-supplied
//     `key` option on `resource()`. Stable across reorders / conditionals;
//     the recommended path for any resource whose creation isn't
//     unconditional.
// ---------------------------------------------------------------------------

let hydrationCache: unknown[] | null = null;
let hydrationCursor = 0;
let hydrationCacheByKey: Record<string, unknown> | null = null;

// Null-prototype copy so `key in hydrationCacheByKey` can't match prototype
// methods (`constructor`, `toString`, `__proto__`, `hasOwnProperty`, …) for
// a user-supplied `key`. JSON.parse always returns prototype-having objects.
function intoNullProto(src: Record<string, unknown>): Record<string, unknown> {
  const dst = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(src)) dst[k] = src[k];
  return dst;
}

/**
 * Accept the legacy array shape (`[v0, v1, …]`) or the new object shape
 * (`{ ordered: [...], keyed: {...} }`). Older renderToString output is the
 * array; new output uses the object form when at least one resource opts
 * into a `key`. Defensive against unknown shapes — anything else is
 * treated as "no cache."
 *
 * @internal
 */
export function primeHydrationCache(data: unknown): void {
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
        ? intoNullProto(obj.keyed as Record<string, unknown>)
        : null;
    return;
  }
  hydrationCache = null;
  hydrationCacheByKey = null;
}

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

/** @internal */
export function clearHydrationCache(): void {
  hydrationCache = null;
  hydrationCursor = 0;
  hydrationCacheByKey = null;
}
