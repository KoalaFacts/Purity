// ---------------------------------------------------------------------------
// onlineSignal() — reactive `navigator.onLine`. ADR 0041.
//
// Server: returns `compute(() => true)`.
// Client: lazy singleton; initial value from `navigator.onLine`, updated
//         by `online` / `offline` window events.
// ---------------------------------------------------------------------------

import { createBrowserSignal, resetBrowserSignal, type BrowserSignal } from './browser-signal.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

const source: BrowserSignal<boolean> = { value: null, stop: null };

// Initial/fallback reads use the platform value; events themselves determine
// subsequent values even when a shim leaves navigator.onLine unchanged.
function readOnline(event?: Event): boolean {
  return event ? event.type === 'online' : navigator.onLine === true;
}

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
  return (
    source.value ??
    createBrowserSignal(source, readOnline, window, ['online', 'offline'], 'onlineSignal')
  );
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listeners so subsequent test runs start from a clean state. */
export function _resetOnlineSignal(): void {
  resetBrowserSignal(source);
}
