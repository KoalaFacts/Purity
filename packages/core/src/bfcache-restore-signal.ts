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
  const handler = (e: PageTransitionEvent): void => {
    // Throw isolation — a thrown `persisted` getter or a downstream
    // subscriber must not poison the `pageshow` callback and break
    // every subsequent restore detection.
    try {
      // Strict `=== true` matches the doc contract and rejects truthy
      // non-boolean values from quirky environments.
      if (e.persisted !== true) return;
      counter((v) => {
        // Saturate at MAX_SAFE_INTEGER so a hostile / extremely
        // long-lived tab can't slide into float territory where
        // `v + 1 === v` and the signal silently stops firing.
        if (v >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
        return v + 1;
      });
    } catch (err) {
      console.error('[purity] bfcacheRestoreSignal: pageshow handler threw', err);
    }
  };
  // Attach FIRST, then publish the module-level refs. If
  // `addEventListener` throws (e.g. patched window in some sandbox),
  // we must not leave `listener`/`singleton` populated — otherwise a
  // subsequent call short-circuits on the cached singleton and
  // `_resetBfcacheRestoreSignal()` would call `removeEventListener`
  // on a listener that was never attached.
  try {
    window.addEventListener('pageshow', handler as EventListener);
  } catch (err) {
    console.error('[purity] bfcacheRestoreSignal: failed to register pageshow listener', err);
    // Half-bound rollback — return a one-shot non-singleton state(0)
    // so the caller still gets a usable accessor without pinning a
    // broken singleton.
    return state(0);
  }
  listener = handler;
  singleton = counter;
  return counter;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listener so subsequent test runs start from a clean state. */
export function _resetBfcacheRestoreSignal(): void {
  if (listener && typeof window !== 'undefined') {
    try {
      window.removeEventListener('pageshow', listener as EventListener);
    } catch {
      /* noop — defensive against sandboxes that throw on removal. */
    }
  }
  listener = null;
  singleton = null;
}
