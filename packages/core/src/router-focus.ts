// ---------------------------------------------------------------------------
// manageNavFocus() — move focus to the new page's landmark on programmatic
// navigate(). ADR 0016.
//
// SPAs typically replace the page content without firing any of the events
// screen readers normally use to announce a new page. Moving keyboard focus
// into the new content does the right thing across AT vendors: NVDA / JAWS /
// VoiceOver all announce the focused element + its accessible name when
// focus lands on a new region. Pairs with manageNavScroll() — focus
// `{ preventScroll: true }` so the two don't fight.
//
// Default behavior:
//   * URL has a hash + element exists → focus that element
//     (matches manageNavScroll's hash target; same element receives both)
//   * Otherwise → focus the first element matching `selector` (default
//     `'main'`, i.e. the page's <main> landmark)
//   * Element isn't naturally focusable → set tabindex="-1" before
//     focusing so .focus() takes effect. Existing tabindex values are
//     preserved.
//
// No-op on the server. Returns a teardown for HMR / tests.
// ---------------------------------------------------------------------------

import { onNavigate } from './router.ts';

const DEFAULT_SELECTOR = 'main';

/** Options for {@link manageNavFocus}. */
export interface ManageNavFocusOptions {
  /**
   * CSS selector identifying the element to focus when the URL has no
   * hash target. Default `'main'` — the page's `<main>` landmark.
   *
   * Common alternatives: `'h1'` (focuses the page heading instead),
   * `'[role="region"][aria-label]'` (a labeled region the user named),
   * or an app-specific `'.app-content'`.
   */
  selector?: string;
  /**
   * Replace the default focus handler entirely. Receives `(url, replace)`
   * from {@link onNavigate}; do whatever focus / announce / live-region
   * work fits your app. When supplied, `selector` is ignored.
   */
  onNavigate?: (url: URL, replace: boolean) => void;
}

function focusElement(el: HTMLElement): void {
  // Programmatic .focus() needs the element to be focusable. Landmark
  // elements (<main>, <section>, etc.) aren't focusable by default;
  // tabindex="-1" makes them focusable via JS without putting them in
  // the keyboard tab order. We don't overwrite an existing tabindex —
  // users opting their own elements into the tab order keep their choice.
  if (!el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
  }
  // preventScroll: true so manageNavScroll's scroll-to-top isn't undone
  // by focus auto-scrolling the page back to the landmark.
  el.focus({ preventScroll: true });
}

/**
 * Install a focus-on-navigate handler. After every programmatic
 * `navigate()` call the matching element gets keyboard focus, which
 * screen readers announce — closing the SPA accessibility gap.
 *
 * Default behavior: focus the URL's hash target if it exists, else focus
 * the first element matching the selector (default `'main'`).
 *
 * No-op on the server. Pairs with {@link manageNavScroll} — both use
 * `preventScroll` / scroll APIs that don't fight each other.
 *
 * @example
 * ```ts
 * // entry.client.ts
 * import { hydrate, interceptLinks, manageNavFocus, manageNavScroll } from '@purityjs/core';
 *
 * hydrate(document.getElementById('app')!, App);
 * interceptLinks();
 * manageNavScroll();
 * manageNavFocus();
 * ```
 */
export function manageNavFocus(options: ManageNavFocusOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  const selector = options.selector ?? DEFAULT_SELECTOR;
  const customHandler = options.onNavigate;

  const handler = customHandler
    ? customHandler
    : (url: URL): void => {
        // Hash target takes precedence — matches manageNavScroll so the
        // user gets a coherent "scroll + focus on the same element" feel.
        if (url.hash) {
          const id = decodeURIComponent(url.hash.slice(1));
          const hashEl = document.getElementById(id);
          if (hashEl) {
            focusElement(hashEl);
            return;
          }
        }
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el) focusElement(el);
      };

  return onNavigate((url, replace) => {
    // Microtask defer — same reasoning as manageNavScroll: route handlers
    // may mount the target element synchronously in response to the
    // reactive URL signal, but the DOM only flushes after the current
    // task. Deferring gives the new landmark a chance to exist.
    queueMicrotask(() => handler(url, replace));
  });
}
