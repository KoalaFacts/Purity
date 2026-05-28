// ---------------------------------------------------------------------------
// localeSignal() — reactive `navigator.language`. ADR 0041.
//
// Server: returns `compute(() => 'en')`.
// Client: lazy singleton; initial value from `navigator.language`, updated
//         on the `languagechange` window event.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<string> | null = null;

/**
 * Reactive `navigator.language` (ADR 0041).
 *
 * - **Server.** Returns a constant `'en'`. Apps with locale-aware SSR
 *   wire request-driven defaults at the loader level, not here.
 * - **Client.** Singleton; registers one `languagechange` window
 *   listener.
 */
export function localeSignal(): ComputedAccessor<string> {
  if (
    getSSRRenderContext() !== null ||
    typeof window === 'undefined' ||
    typeof navigator === 'undefined'
  ) {
    return compute(() => 'en');
  }
  if (singleton) return singleton;
  const inner = state(navigator.language || 'en');
  window.addEventListener('languagechange', () => {
    inner(navigator.language || 'en');
  });
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. */
export function _resetLocaleSignal(): void {
  singleton = null;
}
