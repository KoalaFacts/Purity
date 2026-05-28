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
  mql.addEventListener('change', (e: MediaQueryListEvent) => {
    inner(e.matches);
  });
  const accessor = compute(() => inner());
  cache.set(query, accessor);
  return accessor;
}

/** @internal — test helper. Clears the per-query singleton cache. */
export function _resetMediaSignalCache(): void {
  cache.clear();
}
