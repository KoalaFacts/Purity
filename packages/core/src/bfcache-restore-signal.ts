// ---------------------------------------------------------------------------
// bfcacheRestoreSignal() — reactive counter for bfcache restores. ADR 0039.
//
// Lazy singleton: first call registers one `pageshow` listener, subsequent
// calls return the cached counter. Increments only when
// `event.persisted === true` (i.e. an actual bfcache restore, not a fresh
// load). SSR / non-browser contexts return a `state(0)` that never moves.
// ---------------------------------------------------------------------------

import { bindListeners, isolate } from './listen.ts';
import { state, type StateAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: StateAccessor<number> | null = null;
let unbind: (() => void) | null = null;

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
  // Strict `=== true` matches the doc contract and rejects truthy
  // non-boolean values from quirky environments. Throw isolation keeps a
  // thrown `persisted` getter or a downstream subscriber from poisoning
  // every subsequent restore detection.
  unbind = bindListeners(
    [
      [
        window,
        'pageshow',
        isolate('bfcacheRestoreSignal', (e) => {
          if ((e as PageTransitionEvent).persisted !== true) return;
          counter((v) => {
            // Saturate at MAX_SAFE_INTEGER so a hostile / extremely
            // long-lived tab can't slide into float territory where
            // `v + 1 === v` and the signal silently stops firing.
            if (v >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
            return v + 1;
          });
        }),
      ],
    ],
    'bfcacheRestoreSignal',
  );
  // A failed bind returns a one-shot state(0) without pinning a broken
  // singleton.
  if (!unbind) return state(0);
  singleton = counter;
  return counter;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listener so subsequent test runs start from a clean state. */
export function _resetBfcacheRestoreSignal(): void {
  unbind?.();
  unbind = null;
  singleton = null;
}
