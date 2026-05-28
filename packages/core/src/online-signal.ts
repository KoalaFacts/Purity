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
    typeof window.addEventListener !== 'function'
  ) {
    return compute(() => true);
  }
  if (singleton) return singleton;
  const inner = state(navigator.onLine);
  window.addEventListener('online', () => inner(true));
  window.addEventListener('offline', () => inner(false));
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. */
export function _resetOnlineSignal(): void {
  singleton = null;
}
