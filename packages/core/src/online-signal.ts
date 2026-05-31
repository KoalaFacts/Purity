// ---------------------------------------------------------------------------
// onlineSignal() — reactive `navigator.onLine`. ADR 0041.
//
// Server: returns `compute(() => true)`.
// Client: lazy singleton; initial value from `navigator.onLine`, updated
//         by `online` / `offline` window events.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<boolean> | null = null;
let onOnline: (() => void) | null = null;
let onOffline: (() => void) | null = null;

/**
 * Reactive `navigator.onLine` (ADR 0041).
 *
 * - **Server.** Returns a constant `true`.
 * - **Client.** Singleton; registers one `online` + one `offline`
 *   window listener.
 *
 * Note: `navigator.onLine` reports interface-level connectivity (the
 * machine has a non-loopback route), not actual reachability. Apps that
 * need real connectivity wrap a heartbeat resource() / fetch.
 */
export function onlineSignal(): ComputedAccessor<boolean> {
  if (
    getSSRRenderContext() !== null ||
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function' ||
    typeof navigator === 'undefined'
  ) {
    return compute(() => true);
  }
  if (singleton) return singleton;
  // Coerce — some environments expose `onLine` as undefined / non-boolean.
  const inner = state(navigator.onLine === true);
  const handlers = {
    on: () => inner(true),
    off: () => inner(false),
  };
  // Publish the singleton + handler refs BEFORE attaching listeners, so a
  // throw from addEventListener cannot leave the module in a half-bound
  // state (one listener attached, refs lost ⇒ leak on _resetOnlineSignal).
  onOnline = handlers.on;
  onOffline = handlers.off;
  singleton = compute(() => inner());
  try {
    window.addEventListener('online', handlers.on);
    window.addEventListener('offline', handlers.off);
  } catch (err) {
    // Roll back so a partial bind doesn't leak listeners or pin a stale
    // singleton that can never receive updates.
    try {
      window.removeEventListener('online', handlers.on);
    } catch {
      /* noop */
    }
    try {
      window.removeEventListener('offline', handlers.off);
    } catch {
      /* noop */
    }
    onOnline = null;
    onOffline = null;
    singleton = null;
    console.error('[purity] onlineSignal: failed to register listeners', err);
    return compute(() => navigator.onLine === true);
  }
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listeners so subsequent test runs start from a clean state. */
export function _resetOnlineSignal(): void {
  if (typeof window !== 'undefined') {
    if (onOnline) window.removeEventListener('online', onOnline);
    if (onOffline) window.removeEventListener('offline', onOffline);
  }
  onOnline = null;
  onOffline = null;
  singleton = null;
}
