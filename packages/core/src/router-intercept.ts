// ---------------------------------------------------------------------------
// interceptLinks() — convert internal `<a href>` clicks into navigate() calls.
// ADR 0013.
//
// One global click listener on `document`. On every click that resolves to a
// `<a>` element, the default predicate filters out:
//   * modifier keys / non-primary buttons (cmd-click should still open a tab)
//   * `target="_blank"` and other non-_self targets
//   * `download` links
//   * cross-origin hrefs (full-page nav has different security semantics)
//   * `data-no-intercept` opt-out attribute (per-link escape hatch)
//   * pure hash-on-same-page links (let the browser scroll)
//
// Surviving clicks call `event.preventDefault()` and `navigate(href)`. Authors
// no longer write `@click=${(e) => { e.preventDefault(); navigate(href); }}`
// on every `<a>`.
// ---------------------------------------------------------------------------

import { navigate } from './router.ts';

/** Options for {@link interceptLinks}. */
export interface InterceptLinksOptions {
  /**
   * Custom predicate: return `true` to intercept the click, `false` to let
   * the browser handle it natively. Defaults to the conservative behavior
   * above. When supplied, your predicate fully replaces the default —
   * include the modifier-key / target / download / cross-origin checks if
   * you want those exemptions preserved.
   */
  shouldIntercept?: (event: MouseEvent, anchor: HTMLAnchorElement) => boolean;
}

function defaultShouldIntercept(event: MouseEvent, a: HTMLAnchorElement): boolean {
  // Already-prevented by another listener — bail. Checked first so the
  // cheaper short-circuit beats every other property read; a downstream
  // listener that called preventDefault() (modal close, custom widget,
  // etc.) signals "I handled this click — keep your hands off."
  if (event.defaultPrevented) return false;
  // Primary mouse button only — middle-click should still open in new tab.
  // `button` defaults to 0; an undefined button reads as 0 too (jsdom
  // sometimes synthesises events without one). Treat 0/undefined as
  // primary.
  if (event.button !== 0 && event.button !== undefined) return false;
  // Modifier keys: cmd / ctrl / shift / alt open in new tab/window/etc.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  // Anchor with no href: nothing to intercept; let the browser ignore it.
  // (`a.href` reflects the resolved absolute URL — empty string when the
  // attribute is absent. `a.protocol` would be `':'` in that case, which
  // would also fail the scheme check below; bind it explicitly.)
  if (!a.hasAttribute('href')) return false;
  // Scheme allow-list: only intercept http(s) navigations. Other schemes
  // shouldn't reach navigate() at all — `javascript:` runs as JS,
  // `data:` / `blob:` / `vbscript:` / `file:` would push a non-http URL
  // into history (silent SPA 404 + address-bar pollution), `mailto:` /
  // `tel:` / `sms:` need their native handler. `a.origin === 'null'` for
  // most of these happens to bounce them off the cross-origin check
  // below, but only by accident; bind the contract explicitly.
  if (a.protocol !== 'http:' && a.protocol !== 'https:') return false;
  // Per-link opt-out.
  if (a.hasAttribute('data-no-intercept')) return false;
  // target="" / target="_self" are intercepted; anything else (_blank,
  // _top, _parent, named frame, etc.) is not — those have meaningful
  // browsing-context semantics we'd silently break.
  const target = a.getAttribute('target');
  if (target && target !== '_self') return false;
  // Download links — let the browser handle the file. `hasAttribute`
  // catches both `download` and `download="filename"`.
  if (a.hasAttribute('download')) return false;
  // `rel="external"` — author intent is "leave my SPA"; respect it.
  const rel = a.getAttribute('rel');
  if (rel && /\bexternal\b/.test(rel)) return false;
  // Cross-origin — full-page navigation is the safe default.
  if (typeof window !== 'undefined' && a.origin !== window.location.origin) return false;
  // Same-page hash-only links — let the browser scroll natively.
  if (
    typeof window !== 'undefined' &&
    a.pathname === window.location.pathname &&
    a.search === window.location.search &&
    a.hash !== ''
  ) {
    return false;
  }
  return true;
}

let activeListener: ((event: MouseEvent) => void) | null = null;
// Document-side sentinel so an HMR-driven module re-init (which wipes
// `activeListener` back to `null`) still detects the stale listener on
// `document` and refuses to bind a second one. Without this, every save
// during dev would leak a click listener.
const LISTENER_FLAG = '__purityRouterInterceptBound';

/**
 * Install a global click listener that converts qualifying internal `<a>`
 * clicks into {@link navigate} calls.
 *
 * Returns a teardown function. Calling `interceptLinks()` while another
 * interception is already active is a no-op (with a console warning); call
 * the prior teardown first.
 *
 * No-op on the server (no `document` to attach to).
 *
 * @example
 * ```ts
 * // entry.client.ts
 * import { hydrate } from '@purityjs/core';
 * import { interceptLinks } from '@purityjs/core';
 * import { App } from './app.ts';
 *
 * hydrate(document.getElementById('app')!, App);
 * interceptLinks();
 * ```
 */
export function interceptLinks(options: InterceptLinksOptions = {}): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  // HMR-safe dedupe: an HMR module re-eval resets `activeListener` to
  // `null` but the previously-installed `click` listener is still
  // attached to `document`. Without the document-side flag we'd happily
  // bind a second listener every dev save — leaking one per HMR cycle
  // and double-firing `navigate()` per click. Check the flag first.
  if (activeListener || (document as unknown as Record<string, unknown>)[LISTENER_FLAG]) {
    console.warn(
      '[Purity] interceptLinks() called while a previous interception is active. ' +
        'Call the prior teardown first; this call is a no-op.',
    );
    return () => {};
  }
  const should = options.shouldIntercept ?? defaultShouldIntercept;
  const listener = (event: MouseEvent): void => {
    // `event.target` is typed `EventTarget | null` and can be a `Text`
    // node, a `Document`, or in shadow-DOM-piercing cases a `Window`.
    // `closest` only exists on `Element`, so guard via `instanceof`
    // rather than a blind cast — a stray `Text`-target click would
    // otherwise throw `target.closest is not a function` and escape
    // into the browser's "unhandled error" reporter.
    const target = event.target;
    if (!(target instanceof Element)) return;
    // `closest('a')` also matches `<a>` inside `<svg>` — but SVGAElement
    // exposes `href` as an `SVGAnimatedString` (`href.baseVal`) and
    // doesn't have `.origin` / `.pathname` / `.search` / `.protocol` on
    // the same shape as HTMLAnchorElement. Treating one as the other
    // would crash the predicate. Filter to HTML anchors only.
    const anchor = target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    let intercept: boolean;
    try {
      intercept = should(event, anchor);
    } catch (err) {
      // A throwing user-supplied predicate must not escape into the
      // document-level click handler — same isolation pattern as
      // `navigate()`'s wrapper / listener loops.
      console.error('[Purity] interceptLinks predicate threw:', err);
      return;
    }
    if (!intercept) return;
    event.preventDefault();
    try {
      navigate(anchor.href);
    } catch (err) {
      // `navigate()` itself is fail-soft, but a misbehaving
      // `navigateWrapper` or a user `onNavigate` listener could still
      // surface. Don't let the throw reach the browser's global error
      // path — log and move on. The link click is already prevented;
      // the page state may be inconsistent, but the page survives.
      console.error('[Purity] interceptLinks navigate() threw:', err);
    }
  };
  document.addEventListener('click', listener);
  activeListener = listener;
  (document as unknown as Record<string, unknown>)[LISTENER_FLAG] = true;
  return () => {
    if (activeListener === listener) {
      document.removeEventListener('click', listener);
      activeListener = null;
      delete (document as unknown as Record<string, unknown>)[LISTENER_FLAG];
    }
  };
}
