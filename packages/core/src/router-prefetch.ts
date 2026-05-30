// ---------------------------------------------------------------------------
// prefetchManifestLinks — hover-prefetch route modules (ADR 0029).
//
// Sister to interceptLinks. Installs a delegated mouseenter listener that
// looks up the hovered link's pathname against the manifest's routes
// array; on match, fires entry.importFn() + each layout's importFn() to
// warm the bundler's module cache. When the user clicks, asyncRoute's
// next importFn() call resolves from cache and rendering proceeds
// without a network roundtrip.
// ---------------------------------------------------------------------------

import { matchRoute } from './router.ts';

/** Structural shape matching `AsyncRouteEntry` for the prefetch helper. */
interface PrefetchableEntry {
  pattern: string;
  importFn: () => Promise<unknown>;
  layouts: ReadonlyArray<{ importFn: () => Promise<unknown> }>;
}

/** Options for {@link prefetchManifestLinks}. */
export interface PrefetchManifestLinksOptions {
  /**
   * Debounce delay in milliseconds between `mouseenter` and the actual
   * prefetch fire. Default `50` — most accidental hovers (cursor
   * crossing the link in transit) cancel before firing.
   */
  delay?: number;
  /**
   * Custom predicate that replaces the default filter (modifier keys /
   * target / cross-origin / `data-no-prefetch` / same-page hash). Return
   * `true` to fire prefetch, `false` to skip.
   */
  shouldPrefetch?: (event: MouseEvent | FocusEvent, anchor: HTMLAnchorElement) => boolean;
}

function defaultShouldPrefetch(event: MouseEvent | FocusEvent, a: HTMLAnchorElement): boolean {
  // Modifier keys (mouse events only) — user is about to open in a new tab.
  if ('metaKey' in event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
    return false;
  }
  // Per-link opt-out.
  if (a.hasAttribute('data-no-prefetch')) return false;
  // target="" / target="_self" are prefetchable; anything else is not.
  const target = a.getAttribute('target');
  if (target && target !== '_self') return false;
  // Download links — the browser will handle, no SPA chunk involved.
  if (a.hasAttribute('download')) return false;
  // Scheme allow-list: only prefetch http(s) navigations. `a.origin` is
  // `'null'` for `javascript:` / `data:` / `mailto:` etc. in current
  // browsers — that incidentally falls through the cross-origin check
  // below, but `blob:<page-origin>/...` and `filesystem:<page-origin>/...`
  // inherit the page origin and would slip past it. Bind the contract
  // explicitly. Mirrors the allow-list in router-intercept.ts.
  if (a.protocol !== 'http:' && a.protocol !== 'https:') return false;
  // Cross-origin — full-page navigation, nothing to prefetch.
  if (typeof window !== 'undefined' && a.origin !== window.location.origin) return false;
  // Same-page hash-only — no module load needed.
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

/**
 * Install a delegated `mouseenter` listener that prefetches matching
 * manifest entries' modules on link hover (ADR 0029). The returned
 * function tears down the listener.
 *
 * No-op on the server (no `document` to attach to).
 *
 * @example
 * ```ts
 * import { configureNavigation, prefetchManifestLinks } from '@purityjs/core';
 * import { routes } from 'purity:routes';
 *
 * configureNavigation();
 * prefetchManifestLinks(routes);
 * ```
 */
export function prefetchManifestLinks(
  routes: ReadonlyArray<PrefetchableEntry>,
  options: PrefetchManifestLinksOptions = {},
): () => void {
  if (typeof document === 'undefined') return () => {};
  const delay = options.delay ?? 50;
  const should = options.shouldPrefetch ?? defaultShouldPrefetch;
  // Map of <a> elements with a pending setTimeout; cancel on mouseleave / focusout.
  const pending = new Map<HTMLAnchorElement, ReturnType<typeof setTimeout>>();
  // Anchors we've already kicked off a prefetch for. Dedupes hovering
  // over the same link twice within a session.
  const fired = new WeakSet<HTMLAnchorElement>();
  // Flag consulted by in-flight `.catch` callbacks so they short-circuit
  // after teardown. Dynamic `import()` cannot be aborted, but we can stop
  // mutating `fired` and stop starting new imports.
  let disposed = false;

  function findMatch(pathname: string): PrefetchableEntry | null {
    for (const entry of routes) {
      if (matchRoute(entry.pattern, pathname)) return entry;
    }
    return null;
  }

  function firePrefetch(anchor: HTMLAnchorElement): void {
    if (disposed) return;
    if (fired.has(anchor)) return;
    const entry = findMatch(anchor.pathname);
    if (!entry) return;
    fired.add(anchor);
    // Fire route + layout imports in parallel. Errors swallowed — the
    // click path will surface them via the normal error boundary.
    const imports: Array<Promise<unknown>> = [entry.importFn()];
    for (const layout of entry.layouts) imports.push(layout.importFn());
    Promise.all(imports).catch(() => {
      // Allow retry on next hover — unless teardown happened, in which
      // case the WeakSet is closure-private and irrelevant anyway, but
      // avoid the late mutation for cleanliness.
      if (disposed) return;
      fired.delete(anchor);
    });
  }

  function onEnter(event: MouseEvent | FocusEvent): void {
    if (disposed) return;
    const target = event.target as Element | null;
    if (!target) return;
    // For mouseover delegation: if the cursor merely moved between two
    // descendants of the same anchor, `event.relatedTarget` is inside
    // the anchor too — skip the expensive `should()` work. Mimics the
    // native `mouseenter` semantics ("fired once per cursor entry").
    if ('relatedTarget' in event) {
      const related = (event as MouseEvent).relatedTarget as Node | null;
      const fromAnchor =
        related && 'closest' in related ? ((related as Element).closest?.('a') ?? null) : null;
      // Walk up from the current target too, before doing it again below,
      // so the same-anchor short-circuit is one closest() call cheaper.
      const intoAnchor = (target.closest?.('a') ?? null) as HTMLAnchorElement | null;
      if (!intoAnchor) return;
      if (fromAnchor === intoAnchor) return;
      if (pending.has(intoAnchor) || fired.has(intoAnchor)) return;
      if (!should(event, intoAnchor)) return;
      const timer = setTimeout(() => {
        pending.delete(intoAnchor);
        firePrefetch(intoAnchor);
      }, delay);
      pending.set(intoAnchor, timer);
      return;
    }
    // Focus path — `mouseenter`-style descendant noise doesn't apply.
    const anchor = (target.closest?.('a') ?? null) as HTMLAnchorElement | null;
    if (!anchor) return;
    if (pending.has(anchor) || fired.has(anchor)) return;
    if (!should(event, anchor)) return;
    const timer = setTimeout(() => {
      pending.delete(anchor);
      firePrefetch(anchor);
    }, delay);
    pending.set(anchor, timer);
  }

  function onLeave(event: Event): void {
    const target = event.target as Element | null;
    if (!target) return;
    const anchor = (target.closest?.('a') ?? null) as HTMLAnchorElement | null;
    if (!anchor) return;
    const timer = pending.get(anchor);
    if (timer !== undefined) {
      clearTimeout(timer);
      pending.delete(anchor);
    }
  }

  // `mouseover` bubbles (mouseenter doesn't), so delegate via mouseover +
  // mouseout. Same UX as native mouseenter — fires once per cursor entry
  // into the link (we short-circuit via `event.relatedTarget` for moves
  // between descendants of the same anchor, plus the `pending` map +
  // `fired` WeakSet).
  document.addEventListener('mouseover', onEnter, true);
  document.addEventListener('mouseout', onLeave, true);
  // Also fire on focus for keyboard users navigating with Tab. Pair with
  // focusout so Tabbing past a link cancels its pending timer (otherwise
  // rapid-Tab through N links queues N concurrent prefetches).
  document.addEventListener('focusin', onEnter, true);
  document.addEventListener('focusout', onLeave, true);

  return () => {
    disposed = true;
    document.removeEventListener('mouseover', onEnter, true);
    document.removeEventListener('mouseout', onLeave, true);
    document.removeEventListener('focusin', onEnter, true);
    document.removeEventListener('focusout', onLeave, true);
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  };
}
