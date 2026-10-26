// ---------------------------------------------------------------------------
// localeSignal() — reactive `navigator.language`. ADR 0041.
//
// Server: returns `compute(() => 'en')`.
// Client: lazy singleton; initial value from `navigator.language`, updated
//         on the `languagechange` window event.
// ---------------------------------------------------------------------------

import { createBrowserSignal, resetBrowserSignal, type BrowserSignal } from './browser-signal.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

const source: BrowserSignal<string> = { value: null, stop: null };

// Coerce — some environments expose `navigator.language` as a non-string
// (undefined, null, an array, etc.). Always return a usable string.
function readLanguage(): string {
  const lang = (navigator as { language?: unknown }).language;
  return typeof lang === 'string' && lang.length > 0 ? lang : 'en';
}

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
    typeof window.addEventListener !== 'function' ||
    typeof navigator === 'undefined'
  ) {
    return compute(() => 'en');
  }
  return (
    source.value ??
    createBrowserSignal(source, readLanguage, window, ['languagechange'], 'localeSignal')
  );
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listener so subsequent test runs start from a clean state. */
export function _resetLocaleSignal(): void {
  resetBrowserSignal(source);
}
