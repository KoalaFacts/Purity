// ---------------------------------------------------------------------------
// pageVisibilitySignal() — reactive `document.visibilityState`. ADR 0039.
//
// Lazy singleton: first call registers one `visibilitychange` listener,
// subsequent calls return the cached signal. SSR / non-browser contexts
// return a constant `'visible'`.
// ---------------------------------------------------------------------------

import { createBrowserSignal, resetBrowserSignal, type BrowserSignal } from './browser-signal.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

const source: BrowserSignal<'visible' | 'hidden'> = { value: null, stop: null };

/**
 * Per the Page Visibility spec, `document.visibilityState` is either
 * `'visible'` or `'hidden'` (with historical `'prerender'` / `'unloaded'`).
 * Any non-`'visible'` value — including unexpected strings or non-strings
 * from a malformed shim — must normalize to `'hidden'` rather than leak
 * through the `'visible' | 'hidden'` type.
 */
function readVisibility(): 'visible' | 'hidden' {
  const v = (document as { visibilityState?: unknown }).visibilityState;
  return v === 'visible' ? 'visible' : 'hidden';
}

/**
 * Reactive `document.visibilityState` (ADR 0039).
 *
 * - **Server.** Returns a constant `'visible'`.
 * - **Client.** Singleton lazy-initialised on first call; registers one
 *   `visibilitychange` listener.
 */
export function pageVisibilitySignal(): ComputedAccessor<'visible' | 'hidden'> {
  if (
    getSSRRenderContext() !== null ||
    typeof document === 'undefined' ||
    typeof document.addEventListener !== 'function' ||
    typeof document.removeEventListener !== 'function'
  ) {
    return compute(() => 'visible' as const);
  }
  return (
    source.value ??
    createBrowserSignal(
      source,
      readVisibility,
      document,
      ['visibilitychange'],
      'pageVisibilitySignal',
      true,
      () => 'visible' as const,
    )
  );
}

/** @internal — test helper. Clears the cached singleton and removes the
 * document listener so subsequent test runs start from a clean state. */
export function _resetPageVisibilitySignal(): void {
  resetBrowserSignal(source);
}
