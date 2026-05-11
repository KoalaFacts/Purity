// ---------------------------------------------------------------------------
// manageNavAnnounce() — ARIA live-region route announcer (ADR 0037).
//
// Alternative to manageNavFocus() (ADR 0016) for routes that prefer
// announce-only screen-reader behavior. Subscribes to `onNavigate()` and
// writes the current page name into a `<div aria-live="polite">` region
// after every nav — AT vendors then announce the new text without the
// focus moving away from whatever the user was on (search input, switch
// control, etc.).
//
// Default behavior:
//   * Region: find by id (default `'__purity_announce__'`); create one off-
//     screen via sr-only inline styles if missing.
//   * Live politeness: `'polite'`. Switchable to `'assertive'` per
//     ADR 0037 — both have documented use cases.
//   * Message: `document.title` after a microtask (gives manageTitle / head()
//     time to update); falls back to `url.pathname` if the title hasn't
//     changed or is empty.
//   * Microtask defer matches manageNavFocus + manageNavScroll so route-
//     mounted DOM exists before the announce text is computed.
//
// No-op on the server. Returns a teardown for HMR / tests.
// ---------------------------------------------------------------------------

import { onNavigate } from './router.ts';

const DEFAULT_REGION_ID = '__purity_announce__';

/** Options for {@link manageNavAnnounce}. */
export interface ManageNavAnnounceOptions {
  /**
   * Id of the ARIA live region to write into. Default `'__purity_announce__'`.
   * If no element with this id exists, the helper creates one off-screen
   * and appends it to `<body>`. Apps that want their own region (with
   * existing styles / placement / role tweaks) declare it in their HTML
   * and pass its id here.
   */
  regionId?: string;
  /**
   * ARIA live politeness. Default `'polite'` (announces when the user is
   * idle, matches "non-urgent route changed" semantics). Use
   * `'assertive'` for error pages / urgent state transitions that
   * shouldn't queue behind other AT speech. Only takes effect when the
   * helper creates the region; existing user-authored regions keep their
   * own `aria-live` attribute.
   */
  live?: 'polite' | 'assertive';
  /**
   * Custom message generator. Receives `(url, replace)` from
   * {@link onNavigate}; returns the string written to the region.
   * Default reads `document.title` (so apps using `head()` / `manageTitle`
   * announce the title) and falls back to `url.pathname` when title is
   * empty.
   */
  message?: (url: URL, replace: boolean) => string;
  /**
   * Replace the default handler entirely. Receives `(url, replace)`;
   * do whatever announce / live-region / focus work your app needs.
   * When supplied, `regionId` / `live` / `message` are all ignored —
   * the helper just subscribes the custom handler to `onNavigate`.
   */
  onNavigate?: (url: URL, replace: boolean) => void;
}

/**
 * Inline visually-hidden styles for an auto-created announce region.
 * Matches the canonical "sr-only" recipe — visible to AT, invisible
 * to sighted users, doesn't disrupt layout.
 */
const SR_ONLY_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
  'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';

function ensureRegion(regionId: string, live: 'polite' | 'assertive'): HTMLElement {
  const existing = document.getElementById(regionId);
  if (existing) return existing;
  const region = document.createElement('div');
  region.id = regionId;
  region.setAttribute('aria-live', live);
  region.setAttribute('aria-atomic', 'true');
  // role="status" pairs with aria-live='polite'; "alert" pairs with
  // 'assertive'. AT support overlaps but the explicit role disambiguates
  // for older readers that only key off role.
  region.setAttribute('role', live === 'assertive' ? 'alert' : 'status');
  region.setAttribute('style', SR_ONLY_STYLE);
  document.body.appendChild(region);
  return region;
}

function defaultMessage(url: URL): string {
  const title = document.title.trim();
  return title.length > 0 ? title : url.pathname;
}

/**
 * Install an ARIA live-region announce-on-navigate handler. After every
 * programmatic `navigate()` the configured region's text content is
 * updated, which AT announces without disrupting the user's current
 * focus.
 *
 * Complements (or replaces) {@link manageNavFocus}. Apps that move focus
 * into the new landmark usually don't also need announce — focus-move
 * already produces an announce. Apps that *don't* want to move focus
 * (search-heavy UIs, kiosks with a keyboard cursor, switch-access setups)
 * use announce as the lighter alternative.
 *
 * No-op on the server. Returns a teardown function for HMR / tests.
 *
 * @example
 * ```ts
 * // entry.client.ts
 * import { hydrate, interceptLinks, manageNavAnnounce, manageNavScroll } from '@purityjs/core';
 *
 * hydrate(document.getElementById('app')!, App);
 * interceptLinks();
 * manageNavScroll();
 * // Announce route changes via ARIA live region — no focus move.
 * manageNavAnnounce();
 * ```
 *
 * @example Custom message and assertive politeness
 * ```ts
 * manageNavAnnounce({
 *   live: 'assertive',
 *   message: (url) => `Navigated to ${url.pathname}`,
 * });
 * ```
 */
export function manageNavAnnounce(options: ManageNavAnnounceOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  const customHandler = options.onNavigate;
  if (customHandler) {
    return onNavigate((url, replace) => {
      queueMicrotask(() => customHandler(url, replace));
    });
  }

  const regionId = options.regionId ?? DEFAULT_REGION_ID;
  const live = options.live ?? 'polite';
  const message = options.message ?? defaultMessage;

  // Per-nav token bumped at the start of every outer microtask. The
  // same-text-restore inner microtask captures the token and only writes
  // back if it's still current — without this guard, a queued restore
  // would clobber a later navigation's direct text set when navs queue
  // rapidly with mixed same/different text.
  let pending = 0;

  return onNavigate((url, replace) => {
    // Microtask defer matches manageNavFocus + manageNavScroll. Route
    // handlers may update document.title (via manageTitle) or mount new
    // DOM synchronously in response to the reactive URL signal; deferring
    // gives those writes a chance to flush before we read.
    queueMicrotask(() => {
      const token = ++pending;
      const region = ensureRegion(regionId, live);
      // Setting textContent to the same value doesn't always re-announce
      // (browsers/ATs vary). Clear-then-set on a second microtask is the
      // documented workaround.
      const text = message(url, replace);
      if (region.textContent === text) {
        region.textContent = '';
        queueMicrotask(() => {
          // Skip if a later navigation already ran — restoring our older
          // text would clobber the newer announce.
          if (token === pending) region.textContent = text;
        });
      } else {
        region.textContent = text;
      }
    });
  });
}
