// ---------------------------------------------------------------------------
// configureNavigation — consolidated setup for the four nav opt-ins
// (ADR 0027). Bundles interceptLinks (ADR 0013) + manageNavScroll
// (ADR 0015) + manageNavFocus (ADR 0016) + manageNavTransitions
// (ADR 0017) into one call.
// ---------------------------------------------------------------------------

import { interceptLinks, type InterceptLinksOptions } from './router-intercept.ts';
import { prefetchManifestLinks, type PrefetchManifestLinksOptions } from './router-prefetch.ts';
import { manageNavScroll, type ManageNavScrollOptions } from './router-scroll.ts';
import { manageNavFocus, type ManageNavFocusOptions } from './router-focus.ts';
import { manageNavTransitions, type ManageNavTransitionsOptions } from './router-transitions.ts';
import { manageNavAnnounce, type ManageNavAnnounceOptions } from './router-announce.ts';

/** Prefetch sub-option for {@link ConfigureNavigationOptions}. */
export interface ConfigureNavigationPrefetch extends PrefetchManifestLinksOptions {
  /** Manifest routes — typically imported from `'purity:routes'`. */
  routes: ReadonlyArray<{
    pattern: string;
    importFn: () => Promise<unknown>;
    layouts: ReadonlyArray<{ importFn: () => Promise<unknown> }>;
  }>;
}

/**
 * Options for {@link configureNavigation}. Each key controls one of the
 * four navigation opt-ins. Per-key semantics:
 *
 * - **Omitted** — helper runs with default options.
 * - **`true`** — same as omitted (explicit "on").
 * - **`false`** — helper is skipped.
 * - **Options object** — helper runs with the supplied options.
 */
export interface ConfigureNavigationOptions {
  /** Forwarded to {@link interceptLinks} (ADR 0013). */
  intercept?: InterceptLinksOptions | boolean;
  /** Forwarded to {@link manageNavScroll} (ADR 0015). */
  scroll?: ManageNavScrollOptions | boolean;
  /** Forwarded to {@link manageNavFocus} (ADR 0016). */
  focus?: ManageNavFocusOptions | boolean;
  /** Forwarded to {@link manageNavTransitions} (ADR 0017). */
  transitions?: ManageNavTransitionsOptions | boolean;
  /**
   * Forwarded to {@link manageNavAnnounce} (ADR 0037). ARIA live-region
   * announcer — alternative to focus-move for routes that prefer
   * announce-only. Off by default; opt in with `true` or an options
   * object. Most apps pair `focus` OR `announce`, not both — moving
   * focus already triggers an AT announce, so the live region is
   * redundant when focus is on.
   */
  announce?: ManageNavAnnounceOptions | boolean;
  /**
   * Forwarded to {@link prefetchManifestLinks} (ADR 0029). Pass
   * `{ routes }` (plus optional `delay` / `shouldPrefetch`) to enable.
   * `false` is the implicit default. `true` is rejected (no routes to
   * prefetch).
   */
  prefetch?: ConfigureNavigationPrefetch | false;
}

function isEnabled(v: unknown): boolean {
  return v !== false;
}

function optionsOf<T>(v: T | boolean | undefined): T | undefined {
  return v === true || v === undefined ? undefined : (v as T);
}

/**
 * One-shot setup for the canonical SPA navigation stack (ADR 0027).
 * Calls {@link interceptLinks}, {@link manageNavScroll},
 * {@link manageNavFocus}, and {@link manageNavTransitions} in order,
 * each enabled by default.
 *
 * Returns a teardown function that disposes all four helpers — useful
 * for tests that want a clean reset between specs. Apps shipping a
 * single-page session usually ignore the return.
 *
 * @example
 * ```ts
 * import { configureNavigation, hydrate } from '@purityjs/core';
 *
 * hydrate(document.getElementById('app')!, App);
 * configureNavigation(); // intercept + scroll + focus + transitions
 *
 * // Skip transitions, customize focus selector:
 * configureNavigation({
 *   transitions: false,
 *   focus: { selector: 'main, [role=main]' },
 * });
 * ```
 */
export function configureNavigation(options: ConfigureNavigationOptions = {}): () => void {
  const teardowns: Array<() => void> = [];
  if (isEnabled(options.intercept)) {
    teardowns.push(interceptLinks(optionsOf<InterceptLinksOptions>(options.intercept)));
  }
  if (isEnabled(options.scroll)) {
    teardowns.push(manageNavScroll(optionsOf<ManageNavScrollOptions>(options.scroll)));
  }
  if (isEnabled(options.focus)) {
    teardowns.push(manageNavFocus(optionsOf<ManageNavFocusOptions>(options.focus)));
  }
  if (isEnabled(options.transitions)) {
    teardowns.push(
      manageNavTransitions(optionsOf<ManageNavTransitionsOptions>(options.transitions)),
    );
  }
  // ADR 0037: announce is opt-in (default off). Apps that prefer announce
  // over focus-move pass `{ focus: false, announce: true }`.
  if (options.announce !== undefined && options.announce !== false) {
    teardowns.push(manageNavAnnounce(optionsOf<ManageNavAnnounceOptions>(options.announce)));
  }
  // ADR 0029: opt-in by passing `{ prefetch: { routes } }`. Unlike the
  // other keys, prefetch has no useful default — needs the manifest.
  if (options.prefetch) {
    // `options.prefetch` is narrowed to ConfigureNavigationPrefetch by the
    // truthy guard (the `false` branch of the union falls through).
    const { routes, ...rest } = options.prefetch;
    teardowns.push(prefetchManifestLinks(routes, rest));
  }
  return () => {
    for (const t of teardowns) t();
  };
}
