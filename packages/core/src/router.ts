// ---------------------------------------------------------------------------
// Router primitives — minimal client-side navigation + path matching.
// ADR 0011.
//
// Three functions:
//   * currentPath()        — reactive pathname (tracks updates from
//                            popstate / navigate). On SSR, reads the path
//                            from `getRequest()` so server + client see the
//                            same value.
//   * navigate(href, opts) — pushState + update the reactive signal. Server:
//                            no-op (there is no history API).
//   * matchRoute(pattern)  — pattern matcher returning `{ params }` on hit,
//                            `null` on miss. Patterns:
//                              /about        — exact
//                              /users/:id    — :param captures
//                              /blog/*       — splat tail
//
// Three primitives compose to user routing: dispatch in render, call
// `navigate()` from link click handlers (intercept `<a>` clicks yourself
// — link interception is out of scope for Phase 1).
// ---------------------------------------------------------------------------

import { state } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

// Reactive signal backing `currentPath()` on the client. Initialised from
// `window.location.pathname` at module load (or '/' on the server). Server
// reads bypass this — they read directly from the SSR context's Request.
const pathSignal = state(
  typeof window !== 'undefined' && window.location ? window.location.pathname : '/',
);

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('popstate', () => {
    pathSignal(window.location.pathname);
  });
}

/**
 * Reactive accessor for the current URL pathname.
 *
 * **Server.** Returns `new URL(request.url).pathname` for the
 * `renderToString` / `renderToStream` / `renderStatic` request supplied
 * via `{ request }`. Returns `'/'` when no request was supplied.
 *
 * **Client.** Returns a tracked signal initialised from
 * `window.location.pathname` and kept in sync with `popstate` events and
 * {@link navigate} calls. Reading this from inside a `watch()` / reactive
 * template establishes a subscription that re-fires when the path changes.
 *
 * @example
 * ```ts
 * import { currentPath, html } from '@purityjs/core';
 *
 * function App() {
 *   const path = currentPath();
 *   if (path === '/') return html`<h1>Home</h1>`;
 *   if (path === '/about') return html`<h1>About</h1>`;
 *   return html`<h1>404</h1>`;
 * }
 * ```
 */
export function currentPath(): string {
  const ssrCtx = getSSRRenderContext();
  if (ssrCtx?.request) return new URL(ssrCtx.request.url).pathname;
  return pathSignal();
}

/** Options for {@link navigate}. */
export interface NavigateOptions {
  /** Use `history.replaceState` instead of `pushState` — no back-stack entry. */
  replace?: boolean;
}

/**
 * Programmatically change the URL on the client. Updates the History API
 * via `pushState` (or `replaceState` when `replace: true`) and triggers
 * subscribers of {@link currentPath}. No-op on the server.
 *
 * Same-origin only; cross-origin hrefs are ignored (use `window.location`
 * for those — full-page nav has different security semantics). Hash- and
 * search-only links update the URL bar but only re-render watchers that
 * read those parts via `new URL(window.location.href)`.
 *
 * @example
 * ```ts
 * import { navigate } from '@purityjs/core';
 *
 * html`<a href="/about" @click=${(e) => {
 *   e.preventDefault();
 *   navigate('/about');
 * }}>About</a>`;
 * ```
 */
export function navigate(href: string, options: NavigateOptions = {}): void {
  if (typeof window === 'undefined' || !window.history) return;
  const url = new URL(href, window.location.origin);
  // Don't navigate cross-origin via pushState — that produces a malformed
  // state. Callers should set `window.location` directly for full-page nav.
  if (url.origin !== window.location.origin) return;
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  pathSignal(url.pathname);
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
  const params: Record<string, string> = {};

  if (patternParts.length === 0) {
    return pathParts.length === 0 ? { params } : null;
  }

  for (let i = 0; i < patternParts.length; i++) {
    const seg = patternParts[i];
    if (seg === '*') {
      params['*'] = pathParts.slice(i).join('/');
      return { params };
    }
    if (i >= pathParts.length) return null;
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(pathParts[i]);
      continue;
    }
    if (seg !== pathParts[i]) return null;
  }
  if (pathParts.length > patternParts.length) return null;
  return { params };
}
