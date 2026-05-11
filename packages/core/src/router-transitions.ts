// ---------------------------------------------------------------------------
// manageNavTransitions() — wrap navigate()-driven URL + DOM updates in
// `document.startViewTransition()` so route changes can cross-fade.
// ADR 0017.
//
// The View Transitions API (`document.startViewTransition`, MDN) snapshots
// the current DOM, calls a callback that mutates it, then animates between
// the captured before/after states. Pairs naturally with `navigate()` where
// the URL signal update synchronously triggers reactive watchers that
// re-render the page.
//
// Capability handled gracefully:
//   * No `document.startViewTransition` (Safari < 18, all FF as of 2026-05) →
//     no-op; navigate() runs unwrapped.
//   * `prefers-reduced-motion: reduce` user preference → skip the transition;
//     navigate() runs unwrapped. Saves both motion sensitivity and CPU.
//
// Async route handlers (resource() inside the route view) aren't fully
// captured — startViewTransition's callback completes before async work
// settles. The MVP wraps the synchronous reactive path; richer support is
// a follow-up.
// ---------------------------------------------------------------------------

import { _setNavigateWrapper } from './router.ts';

/** Options for {@link manageNavTransitions}. */
export interface ManageNavTransitionsOptions {
  /**
   * Optional predicate. Return `true` to wrap this navigation in a view
   * transition; `false` to run it unwrapped. Receives the destination URL
   * and the replace flag. Defaults to "wrap every navigation when the API
   * is supported and the user hasn't requested reduced motion."
   */
  shouldTransition?: (url: URL, replace: boolean) => boolean;
}

// Don't extend `Document` — the modern TS DOM lib already declares
// `startViewTransition(callbackOptions?): ViewTransition` (non-optional,
// narrower callback). We only need a structural shape to feature-test
// for, so use an intersection at the call sites instead.
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

function viewTransitionsSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as DocumentWithViewTransition).startViewTransition === 'function'
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Wrap programmatic `navigate()` calls in `document.startViewTransition()`
 * so route changes can be animated. Returns a teardown function. No-op on
 * the server, no-op when the API isn't supported (silently — the
 * navigation still works, just without the transition).
 *
 * Layers on top of {@link manageNavScroll} / {@link manageNavFocus} —
 * those run in their own microtask after the URL signal updates, which is
 * inside the transition's captured "after" snapshot.
 *
 * **Async route handlers** (a route view that depends on an unresolved
 * `resource()`) aren't fully captured. The transition completes its
 * snapshot the moment the synchronous reactive watchers finish; data
 * arriving later updates the post-transition DOM normally. For
 * transition-aware data loading wrap the route handler logic in your own
 * `shouldTransition` predicate that defers until data is ready.
 *
 * @example
 * ```ts
 * // entry.client.ts
 * import { hydrate, interceptLinks, manageNavScroll, manageNavFocus, manageNavTransitions } from '@purityjs/core';
 *
 * hydrate(document.getElementById('app')!, App);
 * interceptLinks();
 * manageNavScroll();
 * manageNavFocus();
 * manageNavTransitions();
 * ```
 *
 * Style the cross-fade or per-element morph in CSS via the
 * `::view-transition-*` pseudo-elements and `view-transition-name`
 * properties.
 */
export function manageNavTransitions(options: ManageNavTransitionsOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {};
  if (!viewTransitionsSupported()) {
    // Capability missing — no work to do, no wrapper to install. Returning
    // a no-op teardown keeps caller code symmetric with the supported case.
    return () => {};
  }
  const should = options.shouldTransition;

  _setNavigateWrapper((url, replace, update) => {
    if (prefersReducedMotion()) {
      update();
      return;
    }
    if (should && !should(url, replace)) {
      update();
      return;
    }
    // Synchronous callback: urlSignal(url) update fires reactive watchers
    // synchronously, route handlers re-render synchronously, DOM mutations
    // land before the function returns. startViewTransition then captures
    // the new state and animates from the snapshot it took before.
    (document as DocumentWithViewTransition).startViewTransition?.(() => {
      update();
    });
  });

  return () => _setNavigateWrapper(null);
}
