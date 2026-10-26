// ---------------------------------------------------------------------------
// localeSignal() — reactive `navigator.language`. ADR 0041.
//
// Server: returns `compute(() => 'en')`.
// Client: lazy singleton; initial value from `navigator.language`, updated
//         on the `languagechange` window event.
// ---------------------------------------------------------------------------

import { bindListeners } from './listen.ts';
import { withoutScope } from './scope.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

let singleton: ComputedAccessor<string> | null = null;
let unbind: (() => void) | null = null;

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
  if (singleton) return singleton;
  const inner = state(readLanguage());
  unbind = bindListeners([[window, 'languagechange', () => inner(readLanguage())]], 'localeSignal');
  if (!unbind) return compute(() => readLanguage());
  // Page-lifetime singleton must not inherit the creating component's owner.
  singleton = withoutScope(() => compute(inner.get));
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * window listener so subsequent test runs start from a clean state. */
export function _resetLocaleSignal(): void {
  unbind?.();
  unbind = null;
  singleton = null;
}
