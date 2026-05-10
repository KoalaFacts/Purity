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
  // Primary mouse button only — middle-click should still open in new tab.
  if (event.button !== 0) return false;
  // Modifier keys: cmd / ctrl / shift / alt open in new tab/window/etc.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  // Per-link opt-out.
  if (a.hasAttribute('data-no-intercept')) return false;
  // target="" / target="_self" are intercepted; anything else (_blank, etc.) is not.
  const target = a.getAttribute('target');
  if (target && target !== '_self') return false;
  // Download links — let the browser handle the file.
  if (a.hasAttribute('download')) return false;
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
  // Already-prevented by another listener — bail.
  if (event.defaultPrevented) return false;
  return true;
}

let activeListener: ((event: MouseEvent) => void) | null = null;

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
  if (activeListener) {
    console.warn(
      '[Purity] interceptLinks() called while a previous interception is active. ' +
        'Call the prior teardown first; this call is a no-op.',
    );
    return () => {};
  }
  const should = options.shouldIntercept ?? defaultShouldIntercept;
  const listener = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (!target) return;
    // `closest` finds the nearest <a> ancestor — works for clicks on nested
    // <span>/<img> inside the link.
    const anchor = target.closest('a') as HTMLAnchorElement | null;
    if (!anchor) return;
    if (!should(event, anchor)) return;
    event.preventDefault();
    navigate(anchor.href);
  };
  document.addEventListener('click', listener);
  activeListener = listener;
  return () => {
    if (activeListener === listener) {
      document.removeEventListener('click', listener);
      activeListener = null;
    }
  };
}
