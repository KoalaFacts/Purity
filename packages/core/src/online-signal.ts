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
    typeof window.addEventListener !== 'function'
  ) {
    return compute(() => true);
  }
  if (singleton) return singleton;
  const inner = state(navigator.onLine);
  onOnline = () => inner(true);
  onOffline = () => inner(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  singleton = compute(() => inner());
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
