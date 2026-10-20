// ---------------------------------------------------------------------------
// onlineSignal() — reactive `navigator.onLine`. ADR 0041.
//
// Server: returns `compute(() => true)`.
// Client: lazy singleton; initial value from `navigator.onLine`, updated
//         by `online` / `offline` window events.
// ---------------------------------------------------------------------------

import { bindListeners } from './listen.ts';
import { withoutScope } from './scope.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

let singleton: ComputedAccessor<boolean> | null = null;
let unbind: (() => void) | null = null;

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
  unbind = bindListeners(
    [
      [window, 'online', () => inner(true)],
      [window, 'offline', () => inner(false)],
    ],
    'onlineSignal',
  );
  if (!unbind) return compute(() => navigator.onLine === true);
  singleton = withoutScope(() => compute(() => inner()));
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listeners so subsequent test runs start from a clean state. */
export function _resetOnlineSignal(): void {
  unbind?.();
  unbind = null;
  singleton = null;
}
