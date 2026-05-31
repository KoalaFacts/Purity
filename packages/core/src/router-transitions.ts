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

import { _setNavigateWrapper, type NavigateWrapper, type NavigateWrapperToken } from './router.ts';

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
   *   awaitNavigation: async (_url, _replace, { signal }) => {
   *     // Wait one task tick so the route handler's reactive watchers
   *     // have flushed and any `resource()` calls have been registered.
   *     await Promise.resolve();
   *     // Then await the new route's loader promise(s). Pass `signal`
   *     // through to fetch/AbortController consumers so a superseded or
   *     // torn-down navigation can short-circuit.
   *     await Promise.all(pendingLoaderPromises({ signal }));
   *   },
   * });
   * ```
   *
   * The thunk receives `(url, replace, { signal })` for routing
   * decisions. The `signal` aborts when (a) another `navigate()` arrives
   * while this one is still waiting (re-entrant nav — the earlier
   * snapshot is moot) or (b) the wrapper's teardown is invoked while
   * this navigation is mid-flight. Forward it to `fetch()` / your own
   * cancellation plumbing so superseded navigations stop wasting work.
   *
   * Throwing (or rejecting) aborts the transition; navigation still
   * completes because the URL signal update happened synchronously
   * before the await.
   *
   * Return type is `unknown` so synchronous returns also work — the
   * wrapper just `await`s whatever the thunk returns, and `await
   * <non-promise>` is the value itself. Useful for predicate-style
   * gates like `awaitNavigation: () => alreadyReady ? null : asyncFetch()`.
   */
  awaitNavigation?: (url: URL, replace: boolean, ctx: { signal: AbortSignal }) => unknown;
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

  // Performing `update()` inside the View Transition callback is risky:
  // `history.pushState` can throw (SecurityError in sandboxed iframes,
  // exceeded quota), and any synchronous reactive watcher woken by the URL
  // signal write could in principle throw too. A throw out of the callback
  // aborts the transition AND surfaces as the navigate() caller's error —
  // partial URL state with a noisy stack trace. Wrap it so the transition
  // always completes; the navigation already happened (or already failed
  // visibly via `update()`'s own listener isolation).
  const safeUpdate = (update: () => void): void => {
    try {
      update();
    } catch (err) {
      console.error('[purity] navigate update threw inside view transition:', err);
    }
  };

  // Cancellation token for the currently in-flight `awaitNavigation`. Two
  // events flip it to aborted:
  //   1. Re-entrant navigation — a new `navigate()` arrives while a prior
  //      transition is still awaiting. The earlier snapshot is moot; signal
  //      the prior thunk so its loader chain can short-circuit.
  //   2. Teardown — caller dismantles the wrapper mid-flight (component
  //      unmount, test cleanup). The transition is about to be discarded;
  //      same short-circuit.
  // Plain DOM `AbortController` so user code can plumb `signal` into
  // `fetch()` without any adapter layer.
  let inFlight: AbortController | null = null;

  const wrapper: NavigateWrapper = (url, replace, update) => {
    if (prefersReducedMotion()) {
      update();
      return;
    }
    if (should && !should(url, replace)) {
      update();
      return;
    }
    // Supersede any prior in-flight awaitNavigation. The previous
    // transition is still running in the background; its abort handler
    // will see `signal.aborted` and bail out. We then mint a fresh
    // controller for THIS navigation. Even when `awaitNavigation` is not
    // configured we still cycle the controller — keeps the contract
    // simple: one navigation, one signal lifetime.
    if (inFlight) inFlight.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    inFlight = controller;
    // Settle hook clears the slot only if WE are still the live one —
    // a re-entrant navigation may have already swapped in a new controller.
    const settle = (): void => {
      if (inFlight === controller) inFlight = null;
    };
    // The view-transition callback runs the URL update synchronously so
    // reactive watchers fire + the route view renders before the browser
    // samples the "after" snapshot. When `awaitNavigation` is supplied
    // the callback is async — the browser holds the snapshot until the
    // returned promise settles (ADR 0038). Throwing or rejecting aborts
    // the transition but the navigation already happened (update was sync).
    const transition = (document as DocumentWithViewTransition).startViewTransition?.(
      awaitNavigation
        ? async (): Promise<void> => {
            safeUpdate(update);
            try {
              // `controller` may be null on ancient engines without
              // AbortController — fall back to a never-aborting signal
              // so the thunk's `{ signal }` destructure still works.
              const signal: AbortSignal = controller
                ? controller.signal
                : ({
                    aborted: false,
                    addEventListener() {},
                    removeEventListener() {},
                  } as unknown as AbortSignal);
              await awaitNavigation(url, replace, { signal });
            } finally {
              settle();
            }
          }
        : (): void => {
            safeUpdate(update);
            settle();
          },
    );
    // The View Transition spec exposes `.updateCallbackDone` (rejects if the
    // callback rejects) and `.finished` (rejects if the transition itself is
    // aborted). Without observers, an `awaitNavigation` rejection becomes an
    // "Uncaught (in promise)" warning that pollutes test runners + error
    // trackers. The navigation already landed (update is sync); log and move
    // on — same console.error policy as listener isolation.
    if (transition && typeof transition === 'object') {
      const t = transition as {
        updateCallbackDone?: Promise<unknown>;
        finished?: Promise<unknown>;
      };
      t.updateCallbackDone?.catch?.((err) => {
        // Abort-driven rejections are expected (re-entrant nav / teardown).
        // Don't pollute consoles with a "[purity] view-transition callback
        // rejected: AbortError" trail every time the user double-clicks.
        if (err && (err as { name?: string }).name === 'AbortError') return;
        console.error('[purity] view-transition callback rejected:', err);
      });
    }
  };

  // CAS install: capture the token returned by the router so our teardown
  // can prove ownership before clearing. Without this, any subsequent
  // `_setNavigateWrapper()` caller (from this module OR a different one) is
  // silently uninstalled when our teardown later runs — the single-slot
  // semantics (last writer wins) otherwise become a stale-teardown footgun
  // across siblings (cross-file backlog item #15).
  const token: NavigateWrapperToken | null = _setNavigateWrapper(wrapper);

  return () => {
    // CAS clear: pass our token back so the router only nulls the slot when
    // OUR wrapper is still installed. If a later caller has since taken over,
    // the router rejects the swap and the live wrapper is preserved.
    _setNavigateWrapper(null, token);
    // Cancel any awaitNavigation that's still in flight. The thunk's
    // consumers (fetch, custom loaders) observe `signal.aborted` and bail
    // out instead of mutating now-unmounted state. `inFlight` tracks the
    // most recent navigation owned by this wrapper instance; if the last
    // one already settled it'll be null and the abort is a no-op.
    if (inFlight) {
      inFlight.abort();
      inFlight = null;
    }
  };
}
