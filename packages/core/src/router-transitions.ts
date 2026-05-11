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
// Async-aware (ADR 0038): pass `awaitNavigation` to hold the snapshot until
// route data resolves. The View Transitions API supports an async callback
// — `startViewTransition` waits for the returned promise before sampling
// the "after" state and animating. Apps with loader-driven routes pass a
// thunk that resolves once the new route's data has settled.
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
  /**
   * Async-aware view transitions (ADR 0038). When supplied, the wrapper
   * awaits this thunk inside `startViewTransition`'s callback before the
   * browser samples the "after" state. Use it to hold the snapshot until
   * route data is ready — typical pattern:
   *
   * ```ts
   * manageNavTransitions({
   *   awaitNavigation: async () => {
   *     // Wait one task tick so the route handler's reactive watchers
   *     // have flushed and any `resource()` calls have been registered.
   *     await Promise.resolve();
   *     // Then await the new route's loader promise(s).
   *     await Promise.all(pendingLoaderPromises());
   *   },
   * });
   * ```
   *
   * The thunk receives `(url, replace)` for routing decisions. Throwing
   * (or rejecting) aborts the transition; navigation still completes
   * because the URL signal update happened synchronously before the await.
   *
   * Return type is `unknown` so synchronous returns also work — the
   * wrapper just `await`s whatever the thunk returns, and `await
   * <non-promise>` is the value itself. Useful for predicate-style
   * gates like `awaitNavigation: () => alreadyReady ? null : asyncFetch()`.
   */
  awaitNavigation?: (url: URL, replace: boolean) => unknown;
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
  const awaitNavigation = options.awaitNavigation;

  _setNavigateWrapper((url, replace, update) => {
    if (prefersReducedMotion()) {
      update();
      return;
    }
    if (should && !should(url, replace)) {
      update();
      return;
    }
    // The view-transition callback runs the URL update synchronously so
    // reactive watchers fire + the route view renders before the browser
    // samples the "after" snapshot. When `awaitNavigation` is supplied
    // the callback is async — the browser holds the snapshot until the
    // returned promise settles (ADR 0038). Throwing or rejecting aborts
    // the transition but the navigation already happened (update was sync).
    (document as DocumentWithViewTransition).startViewTransition?.(
      awaitNavigation
        ? async (): Promise<void> => {
            update();
            await awaitNavigation(url, replace);
          }
        : (): void => {
            update();
          },
    );
  });

  return () => _setNavigateWrapper(null);
}
