// ---------------------------------------------------------------------------
// Router primitives — minimal client-side navigation + URL part accessors.
// ADR 0011 (path / navigate / match) + ADR 0014 (search / hash signals).
//
// One reactive URL signal backs the three URL-part accessors. popstate +
// hashchange refresh it from window.location; navigate() updates it
// alongside pushState/replaceState. SSR reads bypass the signal — they go
// straight through getRequest()'s Request URL.
// ---------------------------------------------------------------------------

import { state } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

// Reactive signal backing the URL accessors on the client. Initialised from
// `window.location.href` at module load (or a placeholder on the server).
// Server reads bypass this — they read directly from the SSR context's
// Request via getSSRRenderContext().
const urlSignal = state(
  typeof window !== 'undefined' && window.location
    ? new URL(window.location.href)
    : new URL('http://localhost/'),
);

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const refresh = (): void => {
    urlSignal(new URL(window.location.href));
  };
  // popstate fires on history.back/forward. hashchange fires when only the
  // fragment changes (e.g. clicking a non-intercepted `<a href="#x">`).
  // pushState that changes only the search/path doesn't fire any event —
  // users updating the URL outside of navigate() are on their own.
  window.addEventListener('popstate', refresh);
  window.addEventListener('hashchange', refresh);
}

function ssrUrl(): URL | null {
  const ssrCtx = getSSRRenderContext();
  if (!ssrCtx?.request) return null;
  // `new URL` throws TypeError on a malformed URL. SSR adapter code that
  // surfaces an unvetted req.url (edge runtimes, hand-rolled handlers)
  // would otherwise crash every component reading currentPath/Search/Hash,
  // and currentSearch() re-throws on every call. Fall back to null so the
  // hot path stays alive — components see "no request URL", same as the
  // no-SSR-context branch.
  try {
    return new URL(ssrCtx.request.url);
  } catch {
    return null;
  }
}

/**
 * Reactive accessor for the current URL pathname.
 *
 * **Server.** Returns `new URL(request.url).pathname` for the
 * `renderToString` / `renderToStream` / `renderStatic` request supplied
 * via `{ request }`. Returns `'/'` when no request was supplied.
 *
 * **Client.** Returns a tracked accessor initialised from
 * `window.location.pathname` and kept in sync with `popstate` /
 * `hashchange` events and {@link navigate} calls. Reading this from
 * inside a `watch()` / reactive template subscribes to changes.
 */
export function currentPath(): string {
  return (ssrUrl() ?? urlSignal()).pathname;
}

/**
 * Reactive accessor for the current URL search params. Returns a **fresh
 * copy** each call so callers can mutate the returned object without
 * affecting the underlying URL — to change the URL, build a new href and
 * call {@link navigate}.
 *
 * Tracks the same reactive signal as {@link currentPath}, so reading
 * inside a `watch()` re-fires when the URL changes (push/replaceState via
 * `navigate()`, popstate, hashchange).
 *
 * @example
 * ```ts
 * import { currentSearch, navigate, currentPath, html } from '@purityjs/core';
 *
 * function Paginator() {
 *   const page = Number(currentSearch().get('page') ?? '1');
 *   return html`
 *     <p>Page ${page}</p>
 *     <button @click=${() => {
 *       const next = new URLSearchParams(currentSearch());
 *       next.set('page', String(page + 1));
 *       navigate(`${currentPath()}?${next}`);
 *     }}>Next</button>
 *   `;
 * }
 * ```
 */
export function currentSearch(): URLSearchParams {
  // Return a fresh URLSearchParams so caller mutations don't reach the
  // underlying URL (which the user would expect to be authoritative).
  return new URLSearchParams((ssrUrl() ?? urlSignal()).search);
}

/**
 * Reactive accessor for the current URL hash, including the leading `#`,
 * or the empty string if no hash is present.
 *
 * Tracks the same reactive signal as {@link currentPath}; `hashchange`
 * events refresh the signal so reads inside a `watch()` re-fire when the
 * fragment changes (via `<a href="#x">` or programmatic
 * `location.hash = …`).
 */
export function currentHash(): string {
  return (ssrUrl() ?? urlSignal()).hash;
}

/** Options for {@link navigate}. */
export interface NavigateOptions {
  /** Use `history.replaceState` instead of `pushState` — no back-stack entry. */
  replace?: boolean;
}

/** Signature for {@link onNavigate} listeners. */
export type NavigateListener = (url: URL, replace: boolean) => void;

const navigateListeners = new Set<NavigateListener>();

/**
 * Subscribe to programmatic `navigate()` calls. Listeners receive the new
 * URL and whether the call used `{ replace: true }`. Returns a teardown
 * function that removes the listener.
 *
 * Fires synchronously after the History API call and URL signal update,
 * before the function returns. Listener errors are propagated to the
 * caller — wrap your handler if you need isolation.
 *
 * **This does NOT fire on browser-driven popstate / hashchange events.**
 * The reactive accessors ({@link currentPath} / {@link currentSearch} /
 * {@link currentHash}) re-fire on every URL change regardless of source;
 * subscribe to those if you want full coverage.
 *
 * @example
 * ```ts
 * import { onNavigate } from '@purityjs/core';
 *
 * onNavigate((url) => {
 *   console.log('navigated to', url.pathname);
 * });
 * ```
 */
export function onNavigate(fn: NavigateListener): () => void {
  navigateListeners.add(fn);
  return () => navigateListeners.delete(fn);
}

/**
 * Programmatically change the URL on the client. Updates the History API
 * via `pushState` (or `replaceState` when `replace: true`) and triggers
 * subscribers of {@link currentPath} / {@link currentSearch} /
 * {@link currentHash}. No-op on the server.
 *
 * Same-origin only; cross-origin hrefs are ignored (use `window.location`
 * for those — full-page nav has different security semantics).
 *
 * @example
 * ```ts
 * import { navigate } from '@purityjs/core';
 *
 * // Add `?sort=date` to the current URL, replace so back-stack stays tidy.
 * navigate(`${currentPath()}?sort=date`, { replace: true });
 * ```
 */
/**
 * Navigation wrapper hook (ADR 0017). When set, `navigate()` calls the
 * wrapper with the resolved URL + replace flag + an `update` callback that
 * performs the actual History API + signal mutation. The wrapper decides
 * when to call `update()` — synchronously, deferred, or wrapped in
 * `document.startViewTransition()` for view-transition integrations.
 *
 * Single-slot (last setter wins). The intent is one consumer per app
 * (`manageNavTransitions()`); apps wanting multiple effects should compose
 * inside their wrapper.
 *
 * @internal — exposed for `manageNavTransitions()`. Apps that need lower-
 * level control are welcome to use it; the underscore prefix marks the API
 * as opt-in / not yet stabilized.
 */
export type NavigateWrapper = (url: URL, replace: boolean, update: () => void) => void;
let navigateWrapper: NavigateWrapper | null = null;

/** @internal — called by manageNavTransitions(). Pass `null` to clear. */
export function _setNavigateWrapper(fn: NavigateWrapper | null): void {
  navigateWrapper = fn;
}

// Schemes we'll route through pushState. ADR-aligned with the link-intercept
// allow-list (commit 64f1b43): `javascript:` / `data:` / `blob:` / `mailto:`
// all parse via `new URL(href, origin)` to a `null` origin, and the
// cross-origin check below catches them in the common case. But when the
// document itself runs at an opaque/null origin (sandboxed iframe without
// `allow-same-origin`, some `file://` deployments), `null === null` makes
// the origin guard pass — at which point an attacker-crafted
// `javascript:alert(document.cookie)` would land in `history.pushState`
// and any onNavigate handler would see it as a "trusted" route. Defense
// in depth: hard-cap the scheme to http(s).
const ALLOWED_NAVIGATE_PROTOCOLS = new Set(['http:', 'https:']);

export function navigate(href: string, options: NavigateOptions = {}): void {
  if (typeof window === 'undefined' || !window.history) return;
  // `new URL` throws TypeError on a malformed href. navigate() is called
  // from intercepted link clicks (where attackers can craft hostile
  // hrefs), from user code, and from configureNavigation chains — any
  // throw escapes to the caller and breaks the nav. Treat malformed as
  // "no-op", same fail-safe shape as `matchRoute` / `safeDecode` /
  // `ssrUrl` (cycles 1 and 5).
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    console.warn(`[purity] navigate(): invalid href, ignored:`, href);
    return;
  }
  // Scheme allow-list — see ALLOWED_NAVIGATE_PROTOCOLS doc above. Stops
  // `javascript:` / `data:` / `blob:` from reaching pushState even when
  // the host page has an opaque origin.
  if (!ALLOWED_NAVIGATE_PROTOCOLS.has(url.protocol)) {
    console.warn(`[purity] navigate(): blocked non-http(s) scheme, ignored:`, href);
    return;
  }
  // Don't navigate cross-origin via pushState — that produces a malformed
  // state. Callers should set `window.location` directly for full-page nav.
  if (url.origin !== window.location.origin) return;
  const replace = options.replace === true;
  // Single-shot `update()` — a misbehaving navigateWrapper that calls
  // update() twice (e.g. view-transition + sync fallback path) must not
  // pushState the same URL twice or fan-out listeners twice.
  let applied = false;
  const update = (): void => {
    if (applied) return;
    applied = true;
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    urlSignal(url);
    // Fire after the History API + signal update so listeners observe the
    // post-nav state. Isolate each listener so one bad subscriber can't
    // abort the rest + the calling navigate() — same pattern as the
    // scheduler flush, optimistic onSettle, suspense onError, configure
    // teardown, lifecycle callbacks, validator-throws, …
    for (const fn of navigateListeners) {
      try {
        fn(url, replace);
      } catch (err) {
        console.error('[purity] onNavigate listener threw:', err);
      }
    }
  };
  if (navigateWrapper) {
    // Isolate wrapper throws: a throwing view-transition wrapper otherwise
    // (a) aborts the navigation entirely without applying the History API
    // update, and (b) escapes to the navigate() caller — link-click
    // handlers, deep import chains. Match the listener-isolation pattern
    // above and fall back to an unwrapped update so the user lands on the
    // requested page.
    try {
      navigateWrapper(url, replace, update);
    } catch (err) {
      console.error('[purity] navigate wrapper threw:', err);
      update();
    }
  } else {
    update();
  }
}

/** Result of a successful {@link matchRoute} call. */
export interface RouteMatch {
  /** Captured `:param` segments + `*` splat tail (under the `*` key). */
  params: Record<string, string>;
}

/**
 * Match a URL path against a route pattern.
 *
 * Pattern grammar:
 *   * Literal segments — `/about`, `/users/edit`
 *   * `:name` — captures one path segment into `params.name` (URI-decoded)
 *   * `*` — matches the remainder of the path; captured under `params['*']`
 *
 * The `path` argument defaults to {@link currentPath} so calling
 * `matchRoute(pattern)` inside a reactive context auto-tracks the path.
 *
 * Returns `null` on miss; matches require all segments to align (no
 * trailing-segment leftovers unless the pattern ends with `*`).
 *
 * @example
 * ```ts
 * matchRoute('/users/:id', '/users/42');        // → { params: { id: '42' } }
 * matchRoute('/blog/*', '/blog/2026/hello');    // → { params: { '*': '2026/hello' } }
 * matchRoute('/about', '/contact');             // → null
 * ```
 */
export function matchRoute(pattern: string, path?: string): RouteMatch | null {
  const p = path ?? currentPath();
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = p.split('/').filter(Boolean);
  // `Object.create(null)` so a pattern like `/u/:__proto__` can't poison
  // params with an inherited `Object.prototype` slot — and so consumers
  // doing `params.toString` / `params.hasOwnProperty` don't accidentally
  // pick up the prototype's methods. Defense in depth: the named-segment
  // write below also explicitly blocks `__proto__` / `constructor` /
  // `prototype` keys (silent skip; the match still succeeds, but the
  // dangerous slot is unset). Matches the same null-proto / reserved-key
  // guard ssr-runtime + the hydration-cache merge use.
  const params: Record<string, string> = Object.create(null);

  if (patternParts.length === 0) {
    return pathParts.length === 0 ? { params } : null;
  }

  for (let i = 0; i < patternParts.length; i++) {
    const seg = patternParts[i];
    if (seg === '*') {
      // Decode each splat segment so the captured tail matches the
      // `:param` decoding behavior. Asymmetric was a real footgun:
      // `/blog/:section/*` over `/blog/tech/Hello%20World` returned
      // `{ section: 'tech', '*': 'Hello%20World' }`. safeDecode never
      // throws (cycle-1 pattern), so malformed `%` falls back to raw.
      params['*'] = pathParts.slice(i).map(safeDecode).join('/');
      return { params };
    }
    if (i >= pathParts.length) return null;
    if (seg.startsWith(':')) {
      const name = seg.slice(1);
      // Reject prototype-poisoning names. The params bag is null-proto
      // already, but skipping these keys means even a downstream caller
      // that copies `params` into a plain object (`{ ...params }`) can't
      // be tricked into installing a `__proto__` slot.
      if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
        continue;
      }
      params[name] = safeDecode(pathParts[i]);
      continue;
    }
    if (seg !== pathParts[i]) return null;
  }
  if (pathParts.length > patternParts.length) return null;
  return { params };
}

/**
 * `decodeURIComponent` that never throws. A path segment is fully
 * attacker-controllable (address bar, untrusted links), and a malformed
 * percent-sequence like `/users/%` makes the native call raise a
 * `URIError`. Letting that escape would crash route matching — and
 * matchRoute() gates the whole render on both server and client. On a
 * malformed segment we fall back to the raw (still-encoded) bytes so the
 * route still matches and the param is non-empty; the view decides what to
 * do with an undecodable value.
 */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
