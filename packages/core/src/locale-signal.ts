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
let onLanguageChange: (() => void) | null = null;

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
  onLanguageChange = () => {
    inner(navigator.language || 'en');
  };
  window.addEventListener('languagechange', onLanguageChange);
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listener so subsequent test runs start from a clean state. */
export function _resetLocaleSignal(): void {
  if (onLanguageChange && typeof window !== 'undefined') {
    window.removeEventListener('languagechange', onLanguageChange);
  }
  onLanguageChange = null;
  singleton = null;
}
