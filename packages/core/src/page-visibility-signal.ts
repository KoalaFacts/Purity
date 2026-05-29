// ---------------------------------------------------------------------------
// pageVisibilitySignal() — reactive `document.visibilityState`. ADR 0039.
//
// Lazy singleton: first call registers one `visibilitychange` listener,
// subsequent calls return the cached signal. SSR / non-browser contexts
// return a constant `'visible'`.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<'visible' | 'hidden'> | null = null;
let listener: (() => void) | null = null;

/**
 * Reactive `document.visibilityState` (ADR 0039).
 *
 * - **Server.** Returns a constant `'visible'`.
 * - **Client.** Singleton lazy-initialised on first call; registers one
 *   `visibilitychange` listener.
 */
export function pageVisibilitySignal(): ComputedAccessor<'visible' | 'hidden'> {
  if (getSSRRenderContext() !== null || typeof document === 'undefined') {
    return compute(() => 'visible' as const);
  }
  if (singleton) return singleton;
  const inner = state(document.visibilityState as 'visible' | 'hidden');
  listener = () => {
    inner(document.visibilityState as 'visible' | 'hidden');
  };
  document.addEventListener('visibilitychange', listener);
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * document listener so subsequent test runs start from a clean state. */
export function _resetPageVisibilitySignal(): void {
  if (listener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', listener);
  }
  listener = null;
  singleton = null;
}
