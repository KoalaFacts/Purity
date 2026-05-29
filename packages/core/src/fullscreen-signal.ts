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
let onFullscreenChange: (() => void) | null = null;

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
  onFullscreenChange = () => {
    inner(document.fullscreenElement);
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * document listener so subsequent test runs start from a clean state. */
export function _resetFullscreenSignal(): void {
  if (onFullscreenChange && typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', onFullscreenChange);
  }
  onFullscreenChange = null;
  singleton = null;
}
