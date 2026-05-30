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

import { _getNavigationGeneration, onNavigate } from './router.ts';

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
    // The hash is attacker-controllable (e.g. `<a href="#%">`); a malformed
    // percent-sequence makes decodeURIComponent throw. This runs in a
    // microtask, so an uncaught throw would surface as an unhandled error
    // and skip the scroll. Fall back to the raw fragment — getElementById
    // on the undecoded id simply finds nothing and we scroll to top.
    let id: string;
    try {
      id = decodeURIComponent(url.hash.slice(1));
    } catch {
      id = url.hash.slice(1);
    }
    const el = document.getElementById(id);
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
  // Track torn-down state so a microtask queued by a final navigate() that
  // resolves AFTER teardown doesn't sneak in a stray scroll — the
  // onNavigate unsubscribe is synchronous but the handler is deferred to a
  // microtask, opening a small window where teardown happens between the
  // listener firing and the microtask draining.
  let disposed = false;
  const off = onNavigate((url, replace) => {
    // Audit-v2 fix (#2): capture the router's navigation generation when
    // we enqueue. If a SECOND navigate() fires before this microtask
    // drains, the counter advances and we short-circuit — keeping the
    // newer nav's focus / scroll target authoritative and preventing the
    // older nav's microtask from racing the newer one. Mirrors the
    // identical guard in manageNavFocus.
    const generation = _getNavigationGeneration();
    queueMicrotask(() => {
      // Defer to a microtask so any DOM updates triggered by the same
      // navigate() (signal subscribers re-rendering) have a chance to land
      // before we scroll — otherwise a hash target that the router just
      // mounted wouldn't exist yet.
      if (disposed) return;
      // Generation moved on — newer navigate() has happened; drop.
      if (_getNavigationGeneration() !== generation) return;
      // Isolate handler throws — a user-supplied custom `onNavigate`
      // (which the docs explicitly invite to "perform whatever scroll
      // action you want") can throw arbitrary errors, and so can the
      // default handler if a page's `scrollIntoView` is monkey-patched
      // or replaced by an extension. Without this try/catch the throw
      // surfaces as an unhandled microtask rejection, which (a) skips
      // any future scroll-to-top for THIS nav, and (b) pollutes the
      // global error channel with a stack the app can't intercept.
      // Mirror the listener-isolation pattern in router.ts navigate().
      try {
        handler(url, replace);
      } catch (err) {
        console.error('[purity] manageNavScroll handler threw:', err);
      }
    });
  });
  return () => {
    disposed = true;
    off();
  };
}
