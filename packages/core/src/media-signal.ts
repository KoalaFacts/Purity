// ---------------------------------------------------------------------------
// mediaSignal(query) — matchMedia as a signal. ADR 0040.
//
// Server: returns `compute(() => false)`.
// Client: caches a singleton per query string. One `MediaQueryList`
//         `change` listener per query. Initial value is `mql.matches`.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

const cache: Map<string, ComputedAccessor<boolean>> = new Map();
// (mql, listener) pairs so _reset can detach what cache.clear() can't reach.
// Without this, `matchMedia(q)` returning the same MediaQueryList per query
// (real browsers do; jsdom may not) means every reset+rewire stacks a new
// listener on the same target — leak.
const listeners: Map<string, [MediaQueryList, (e: MediaQueryListEvent) => void]> = new Map();

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
  if (
    getSSRRenderContext() !== null ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return compute(() => false);
  }
  const existing = cache.get(query);
  if (existing) return existing;
  const mql = window.matchMedia(query);
  const inner = state(mql.matches);
  const onChange = (e: MediaQueryListEvent): void => {
    inner(e.matches);
  };
  mql.addEventListener('change', onChange);
  listeners.set(query, [mql, onChange]);
  const accessor = compute(() => inner());
  cache.set(query, accessor);
  return accessor;
}

/** @internal — test helper. Detaches each cached `MediaQueryList`
 * listener, then clears the per-query singleton cache. */
export function _resetMediaSignalCache(): void {
  for (const [mql, onChange] of listeners.values()) {
    mql.removeEventListener('change', onChange);
  }
  listeners.clear();
  cache.clear();
}
