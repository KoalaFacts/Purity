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
let listener: ((e: PageTransitionEvent) => void) | null = null;

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
  listener = (e: PageTransitionEvent) => {
    if (e.persisted) counter((v) => v + 1);
  };
  window.addEventListener('pageshow', listener);
  singleton = counter;
  return counter;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listener so subsequent test runs start from a clean state. */
export function _resetBfcacheRestoreSignal(): void {
  if (listener && typeof window !== 'undefined') {
    window.removeEventListener('pageshow', listener as EventListener);
  }
  listener = null;
  singleton = null;
}
