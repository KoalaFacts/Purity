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
  const handler = (): void => {
    inner(readLanguage());
  };
  // Publish the singleton + handler ref BEFORE attaching the listener, so a
  // throw from addEventListener cannot leave the module in a half-bound
  // state (listener attached, ref lost ⇒ leak on _resetLocaleSignal).
  onLanguageChange = handler;
  singleton = compute(() => inner());
  try {
    window.addEventListener('languagechange', handler);
  } catch (err) {
    // Roll back so a partial bind doesn't leak a listener or pin a stale
    // singleton that can never receive updates.
    try {
      window.removeEventListener('languagechange', handler);
    } catch {
      /* noop */
    }
    onLanguageChange = null;
    singleton = null;
    console.error('[purity] localeSignal: failed to register listener', err);
    return compute(() => readLanguage());
  }
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
