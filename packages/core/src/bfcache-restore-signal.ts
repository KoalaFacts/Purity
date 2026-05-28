// ---------------------------------------------------------------------------
// bfcacheRestoreSignal() — reactive counter for bfcache restores. ADR 0039.
//
// Lazy singleton: first call registers one `pageshow` listener, subsequent
// calls return the cached counter. Increments only when
// `event.persisted === true` (i.e. an actual bfcache restore, not a fresh
// load). SSR / non-browser contexts return a `state(0)` that never moves.
// ---------------------------------------------------------------------------

import { state, type StateAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: StateAccessor<number> | null = null;

/**
 * Reactive counter that increments every time the page is restored from
 * the browser's bfcache (ADR 0039). Use as a `watch` dependency to
 * revalidate loaders / refetch resources on back-forward navigation.
 *
 * - **Server.** Returns a `state(0)` that never increments.
 * - **Client.** Singleton; registers one `pageshow` listener and
 *   increments only when `event.persisted === true`.
 *
 * @example
 * ```ts
 * const restored = bfcacheRestoreSignal();
 * watch(restored, () => refetch());
 * ```
 */
export function bfcacheRestoreSignal(): StateAccessor<number> {
  if (
    getSSRRenderContext() !== null ||
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function'
  ) {
    return state(0);
  }
  if (singleton) return singleton;
  const counter = state(0);
  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if (e.persisted) counter((v) => v + 1);
  });
  singleton = counter;
  return counter;
}

/** @internal — test helper. Clears the cached singleton so tests can re-init. */
export function _resetBfcacheRestoreSignal(): void {
  singleton = null;
}
