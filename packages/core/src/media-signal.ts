// ---------------------------------------------------------------------------
// mediaSignal(query) — matchMedia as a signal. ADR 0040.
//
// Server: returns `compute(() => false)`.
// Client: caches a singleton per query string. One `MediaQueryList`
//         `change` listener per query. Initial value is `mql.matches`.
// ---------------------------------------------------------------------------

import { attachMqlChange, type MqlBinding } from './mql-listener.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

const cache: Map<string, ComputedAccessor<boolean>> = new Map();
// (mql, detach) pairs so _reset can detach what cache.clear() can't reach.
// Without this, `matchMedia(q)` returning the same MediaQueryList per query
// (real browsers do; jsdom may not) means every reset+rewire stacks a new
// listener on the same target — leak.
const listeners: Map<string, [MediaQueryList, () => void]> = new Map();

// mediaSignal's detach must never throw — `_resetMediaSignalCache` stores
// and calls it well after the originating `mediaSignal()` call, with no
// caller left to react to a failure, so swallow it here instead.
function bindMediaListener(
  mql: MediaQueryList,
  onChange: (e: MediaQueryListEvent) => void,
): () => void {
  const binding: MqlBinding = { detach: null };
  if (!attachMqlChange(mql, onChange, binding)) {
    // No complete subscription API — accessor will still return the
    // initial `matches`.
    return () => {};
  }
  return () => {
    try {
      binding.detach?.();
    } catch (err) {
      console.error('[purity] mediaSignal: detach failed:', err);
    }
  };
}

/**
 * Reactive `matchMedia` boolean (ADR 0040).
 *
 * - **Server.** Returns `compute(() => false)`.
 * - **Client.** Caches per query string — subsequent calls with the same
 *   query return the same accessor and reuse one underlying
 *   `MediaQueryList` listener.
 *
 * @example
 * ```ts
 * const dark = mediaSignal('(prefers-color-scheme: dark)');
 * manageTitle(() => (dark() ? '🌙 ' : '☀ ') + 'My Site');
 * ```
 */
export function mediaSignal(query: string): ComputedAccessor<boolean> {
  // Guard against bogus inputs (numbers, null, '') that would crash matchMedia
  // in some engines or pollute the cache with a junk key.
  if (typeof query !== 'string' || query.length === 0) {
    if (typeof query !== 'string') {
      console.warn('[purity] mediaSignal: query must be a string, got', query);
    }
    return compute(() => false);
  }
  if (
    getSSRRenderContext() !== null ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return compute(() => false);
  }
  const existing = cache.get(query);
  if (existing) return existing;
  // WebKit throws SyntaxError on malformed CSS media queries (island-mount
  // already handles this on its `media:` trigger path). Fall back to a
  // never-matching constant so the caller's compute() chain keeps working.
  let mql: MediaQueryList;
  try {
    mql = window.matchMedia(query);
  } catch (err) {
    console.warn(`[purity] mediaSignal: invalid query ${JSON.stringify(query)}:`, err);
    const fallback = compute(() => false);
    cache.set(query, fallback);
    return fallback;
  }
  const inner = state(mql.matches);
  const onChange = (e: MediaQueryListEvent): void => {
    inner(e.matches);
  };
  // Listener attach itself can throw on hostile/legacy targets — keep the
  // accessor working (frozen at initial `matches`) instead of crashing the
  // caller, and never poison the cache with a half-wired entry.
  let detach: () => void;
  try {
    detach = bindMediaListener(mql, onChange);
  } catch (err) {
    console.error('[purity] mediaSignal: failed to attach change listener:', err);
    const accessor = compute(() => inner());
    cache.set(query, accessor);
    return accessor;
  }
  listeners.set(query, [mql, detach]);
  const accessor = compute(() => inner());
  cache.set(query, accessor);
  return accessor;
}

/** @internal — test helper. Detaches each cached `MediaQueryList`
 * listener, then clears the per-query singleton cache. */
export function _resetMediaSignalCache(): void {
  for (const [, detach] of listeners.values()) {
    try {
      detach();
    } catch (err) {
      console.error('[purity] mediaSignal: detach during reset failed:', err);
    }
  }
  listeners.clear();
  cache.clear();
}
