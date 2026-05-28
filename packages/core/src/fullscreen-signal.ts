// ---------------------------------------------------------------------------
// fullscreenSignal() — reactive `document.fullscreenElement`. ADR 0041.
//
// Server: returns `compute(() => null)`.
// Client: lazy singleton; initial value from `document.fullscreenElement`,
//         updated on the `fullscreenchange` event.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<Element | null> | null = null;

/**
 * Reactive `document.fullscreenElement` (ADR 0041).
 *
 * - **Server.** Returns a constant `null`.
 * - **Client.** Singleton; registers one `fullscreenchange` listener.
 */
export function fullscreenSignal(): ComputedAccessor<Element | null> {
  if (getSSRRenderContext() !== null || typeof document === 'undefined') {
    return compute(() => null as Element | null);
  }
  if (singleton) return singleton;
  const inner = state<Element | null>(document.fullscreenElement);
  document.addEventListener('fullscreenchange', () => {
    inner(document.fullscreenElement);
  });
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. */
export function _resetFullscreenSignal(): void {
  singleton = null;
}
