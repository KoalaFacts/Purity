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
// Teardown closure captured at wire-time so reset can remove the listener
// even if `document` is shape-mutated between wire and reset.
let teardown: (() => void) | null = null;

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
  if (singleton) return singleton;
  const inner = state<'visible' | 'hidden'>(readVisibility());
  const listener = (): void => {
    // Throw isolation — a malformed shim or stale Object.defineProperty
    // override on `visibilityState` must not bubble out of the DOM
    // event-dispatch path and crash the page.
    try {
      inner(readVisibility());
    } catch (err) {
      console.error('[pageVisibilitySignal] visibilitychange handler failed', err);
    }
  };
  // `addEventListener` is the only call that can throw at wire-time. If it
  // does, leave singleton/teardown unset so a later call can retry cleanly
  // (no half-bound state, no leaked listener).
  try {
    document.addEventListener('visibilitychange', listener);
  } catch (err) {
    console.error('[pageVisibilitySignal] addEventListener failed', err);
    return compute(() => 'visible' as const);
  }
  teardown = () => {
    try {
      document.removeEventListener('visibilitychange', listener);
    } catch {
      // best-effort teardown — secondary failures must not throw out of reset.
    }
  };
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * document listener so subsequent test runs start from a clean state. */
export function _resetPageVisibilitySignal(): void {
  teardown?.();
  teardown = null;
  singleton = null;
}
