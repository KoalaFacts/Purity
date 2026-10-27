// ---------------------------------------------------------------------------
// onlineSignal() — reactive `navigator.onLine`. ADR 0041.
//
// Server: returns `compute(() => true)`.
// Client: lazy singleton; initial value from `navigator.onLine`, updated
//         by `online` / `offline` window events.
// ---------------------------------------------------------------------------

import { bindListeners } from './listen.ts';
import { createSharedBrowserSignal } from './browser-signal-singleton.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

const online = createSharedBrowserSignal(
  () => navigator.onLine === true,
  (update) =>
    bindListeners(
      [
        [window, 'online', () => update(true)],
        [window, 'offline', () => update(false)],
      ],
      'onlineSignal',
    ),
);

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
  return online.get();
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listeners so subsequent test runs start from a clean state. */
export function _resetOnlineSignal(): void {
  online.reset();
}
