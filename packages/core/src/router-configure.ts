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
   * Forwarded to {@link manageNavAnnounce} (ADR 0045). ARIA live-region
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
 * Read an own-property off the options object. Inherited values from
 * `Object.prototype` (e.g. `JSON.parse('{"__proto__":{"intercept":false}}')`)
 * MUST NOT influence helper enablement — otherwise an attacker-controlled
 * prototype could silently disable navigation helpers. We accept the
 * defaults for any non-own key.
 */
function ownProp<K extends keyof ConfigureNavigationOptions>(
  options: ConfigureNavigationOptions,
  key: K,
): ConfigureNavigationOptions[K] {
  return Object.prototype.hasOwnProperty.call(options, key) ? options[key] : undefined;
}

/**
 * Run every teardown, swallowing throws so a single misbehaving helper
 * can't strand the rest. The first error (if any) is rethrown after all
 * teardowns have run; subsequent errors are surfaced via `console.error`
 * so they aren't silently dropped.
 */
function runTeardowns(teardowns: ReadonlyArray<() => void>): void {
  let firstError: unknown;
  let hasError = false;
  for (let i = 0; i < teardowns.length; i++) {
    try {
      teardowns[i]();
    } catch (err) {
      if (!hasError) {
        firstError = err;
        hasError = true;
      } else {
        console.error(err);
      }
    }
  }
  if (hasError) throw firstError;
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
  // Read every key as an own-property up front so a tampered prototype
  // (e.g. `JSON.parse('{"__proto__":{"intercept":false}}')`) can't silently
  // disable a helper. Snapshotting also makes us immune to caller-side
  // mutation of `options` after the call returns.
  const intercept = ownProp(options, 'intercept');
  const scroll = ownProp(options, 'scroll');
  const focus = ownProp(options, 'focus');
  const transitions = ownProp(options, 'transitions');
  const announce = ownProp(options, 'announce');
  const prefetch = ownProp(options, 'prefetch');

  // ADR 0029: `prefetch: true` is documented as rejected — there's no
  // useful default without a routes manifest. Catch it at runtime so a
  // miswired call doesn't silently fall through to `routes: undefined`
  // (which would crash inside prefetchManifestLinks). The TS union
  // already forbids `true`; this guards against JS callers / `as any`.
  if (prefetch === true) {
    throw new TypeError(
      'configureNavigation: `prefetch: true` is not supported — pass `{ routes }` or omit the key.',
    );
  }

  const teardowns: Array<() => void> = [];
  // If any helper throws while installing, unwind every helper that
  // already registered itself. Without this rollback, an earlier
  // `interceptLinks` listener (or any helper before the throw) stays
  // bound to the document forever — a real listener leak on every
  // reconfigure-after-error.
  try {
    if (isEnabled(intercept)) {
      teardowns.push(interceptLinks(optionsOf<InterceptLinksOptions>(intercept)));
    }
    if (isEnabled(scroll)) {
      teardowns.push(manageNavScroll(optionsOf<ManageNavScrollOptions>(scroll)));
    }
    if (isEnabled(focus)) {
      teardowns.push(manageNavFocus(optionsOf<ManageNavFocusOptions>(focus)));
    }
    if (isEnabled(transitions)) {
      teardowns.push(manageNavTransitions(optionsOf<ManageNavTransitionsOptions>(transitions)));
    }
    // ADR 0045: announce is opt-in (default off). Apps that prefer
    // announce over focus-move pass `{ focus: false, announce: true }`.
    if (announce !== undefined && announce !== false) {
      teardowns.push(manageNavAnnounce(optionsOf<ManageNavAnnounceOptions>(announce)));
    }
    // ADR 0029: opt-in by passing `{ prefetch: { routes } }`. Unlike the
    // other keys, prefetch has no useful default — needs the manifest.
    if (prefetch) {
      // `prefetch` is narrowed to ConfigureNavigationPrefetch by the
      // truthy guard (the `false` branch of the union falls through).
      const { routes, ...rest } = prefetch;
      teardowns.push(prefetchManifestLinks(routes, rest));
    }
  } catch (err) {
    // Roll back any helper that already installed before the throw so
    // we don't leak listeners. Best-effort — a teardown that itself
    // throws is logged via runTeardowns and doesn't mask the original.
    try {
      runTeardowns(teardowns);
    } catch (teardownErr) {
      console.error(teardownErr);
    }
    throw err;
  }

  // Idempotent teardown — calling it twice MUST NOT call each helper's
  // teardown twice (some helpers, e.g. transitions, do CAS-style cleanup
  // that misbehaves on double-invoke). Latch on first call.
  let torn = false;
  return () => {
    if (torn) return;
    torn = true;
    runTeardowns(teardowns);
  };
}
