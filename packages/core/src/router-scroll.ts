// ---------------------------------------------------------------------------
// manageNavScroll() — scroll-to-top (or to hash anchor) on programmatic
// navigate(). ADR 0015.
//
// Browsers handle scroll restoration for back/forward navigation on their
// own (`history.scrollRestoration === 'auto'`, default) and scroll to anchor
// targets natively on hashchange. The one gap in SPAs is forward
// `pushState`-style navigation — the browser keeps the previous page's
// scroll position when JS calls pushState, leaving SPAs feeling janky.
//
// manageNavScroll() closes that gap: subscribes to `onNavigate()` and on
// every forward nav scrolls to the URL's hash target (if any) or to (0, 0).
// ~10 LOC including the teardown.
// ---------------------------------------------------------------------------

import { onNavigate } from './router.ts';

/** Options for {@link manageNavScroll}. */
export interface ManageNavScrollOptions {
  /**
   * Override the default behavior. Receives the target URL + whether the
   * navigation was a replace; performs whatever scroll action you want.
   * When supplied, replaces the default entirely — include the
   * scroll-to-hash and scroll-to-top logic yourself if you want those
   * preserved.
   */
  onNavigate?: (url: URL, replace: boolean) => void;
}

function defaultScrollHandler(url: URL): void {
  if (url.hash) {
    const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (el) {
      el.scrollIntoView();
      return;
    }
  }
  window.scrollTo(0, 0);
}

/**
 * Install a default scroll-on-navigate handler. On every programmatic
 * `navigate()` (push or replace) the browser is scrolled either to the
 * URL's hash target (if `<a href="#anchor">` style) or to the top of the
 * page.
 *
 * Browser-driven back/forward navigation already restores scroll natively
 * via `history.scrollRestoration === 'auto'`, and hashchange events
 * scroll to anchors natively, so those paths are unchanged.
 *
 * No-op on the server. Returns a teardown function for HMR / tests.
 *
 * @example
 * ```ts
 * // entry.client.ts
 * import { hydrate, interceptLinks, manageNavScroll } from '@purityjs/core';
 * import { App } from './app.ts';
 *
 * hydrate(document.getElementById('app')!, App);
 * interceptLinks();
 * manageNavScroll();
 * ```
 */
export function manageNavScroll(options: ManageNavScrollOptions = {}): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = options.onNavigate ?? defaultScrollHandler;
  return onNavigate((url, replace) => {
    // Defer to a microtask so any DOM updates triggered by the same
    // navigate() (signal subscribers re-rendering) have a chance to land
    // before we scroll — otherwise a hash target that the router just
    // mounted wouldn't exist yet.
    queueMicrotask(() => handler(url, replace));
  });
}
