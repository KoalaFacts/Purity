// ---------------------------------------------------------------------------
// localeSignal() — reactive `navigator.language`. ADR 0041.
//
// Server: returns `compute(() => 'en')`.
// Client: lazy singleton; initial value from `navigator.language`, updated
//         on the `languagechange` window event.
// ---------------------------------------------------------------------------

import { createBrowserSignal } from './browser-signal.ts';
import { bindListeners } from './listen.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

// Coerce — some environments expose `navigator.language` as a non-string
// (undefined, null, an array, etc.). Always return a usable string.
function readLanguage(): string {
  const lang = (navigator as { language?: unknown }).language;
  return typeof lang === 'string' && lang.length > 0 ? lang : 'en';
}

const source = /* @__PURE__ */ createBrowserSignal(readLanguage, (write) =>
  bindListeners([[window, 'languagechange', () => write(readLanguage())]], 'localeSignal'),
);

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
  return source();
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listener so subsequent test runs start from a clean state. */
export function _resetLocaleSignal(): void {
  source.reset();
}
