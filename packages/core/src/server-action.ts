// ---------------------------------------------------------------------------
// Server actions — minimal RPC + progressive-form-enhancement primitive.
// ADR 0012.
//
// `serverAction(url, handler)` registers a `(Request) => Response` handler at
// a stable URL. `findAction(request)` / `handleAction(request)` let your
// server entry dispatch incoming POSTs to the registered handler before
// falling through to SSR.
//
// Progressive enhancement works out of the box: `<form action=${action.url}
// method="POST">` posts FormData to the registered handler, which can
// respond with a 303 redirect (Post-Redirect-Get) so the browser navigates
// back to a fresh GET. JS apps can call `fetch(action.url, …)` against the
// same URL — same handler, same shape.
//
// Phase 1 explicitly punts on:
//   - CSRF token generation / verification (use SameSite cookies + double-
//     submit or a focused helper library)
//   - Auto-serialization (handler signature is `(Request) => Response`;
//     parse formData/json/text yourself)
//   - A client-side `action.invoke(formData)` helper (just call fetch)
//   - Bundler-side handler-body stripping for client bundles (server
//     actions must live in server-only modules; documented contract)
// ---------------------------------------------------------------------------

/**
 * The handler signature for a server action — a function from a Web
 * Platform `Request` to a `Response` (or a promise of one).
 */
export type ServerActionHandler = (request: Request) => Promise<Response> | Response;

/** A registered server action. */
export interface ServerAction<H extends ServerActionHandler = ServerActionHandler> {
  /** Stable URL path the action is served at. Use this for `<form action="…">`. */
  url: string;
  /** The registered handler. Exposed for direct invocation in tests / SSR. */
  handler: H;
  /**
   * Client-side helper: `POST`s `body` to `this.url` via `fetch` and returns
   * the `Response`. Defaults to method `POST`; pass `init` to override
   * method / headers / credentials / etc. (same shape as `fetch`'s second
   * argument, minus the URL). Throws on the server — server-side callers
   * have `this.handler` directly and don't need a network round-trip.
   *
   * @example
   * ```ts
   * // Inside a form submit handler:
   * async function onSubmit(e: SubmitEvent) {
   *   e.preventDefault();
   *   const form = e.target as HTMLFormElement;
   *   const res = await saveTodo.invoke(new FormData(form));
   *   if (!res.ok) showError(await res.text());
   *   else form.reset();
   * }
   * ```
   */
  invoke(body?: BodyInit | null, init?: RequestInit): Promise<Response>;
}

const registry = new Map<string, ServerActionHandler>();

// Scheme allow-list for serverAction() URLs. Anything else (javascript:,
// data:, blob:, file:, vbscript:, ...) is rejected at registration time
// because `action.invoke()` feeds the URL straight into `fetch()` — a
// `javascript:` URL would be a script-execution vector in environments
// that follow it, and `data:` / `blob:` URLs let an attacker who
// controls the registration string short-circuit the network entirely.
// Same-origin paths (starting with `/`) and absolute http(s) URLs are
// the only shapes a real server action takes.
function assertSafeActionUrl(url: string): void {
  // Reject CR/LF/NUL — these enable response-splitting / header
  // injection when concatenated into a URL or sent through fetch.
  // (Modern fetch normalises some of this, but defense-in-depth.)
  // Also reject tab and other C0 control chars per RFC 3986.
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      throw new TypeError(
        '[Purity] serverAction(): url must not contain control characters (CR/LF/NUL/etc).',
      );
    }
  }
  // Path-style URLs are fine (most common case).
  if (url.charCodeAt(0) === 47 /* '/' */) return;
  // Otherwise it must parse as an absolute URL with an allow-listed scheme.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(
      '[Purity] serverAction(): url must be a path starting with "/" or an absolute http(s) URL.',
    );
  }
  const scheme = parsed.protocol;
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new TypeError(
      `[Purity] serverAction(): url scheme "${scheme}" is not allowed. Use a path or http(s) URL.`,
    );
  }
}

/**
 * Register a server action at a stable URL. Returns a `ServerAction` whose
 * `.url` you wire into your `<form action="…">` or `fetch(url, …)` call.
 *
 * **Server-only.** Files that call `serverAction()` must not be imported
 * from client code — the handler body would ship to the browser. Keep them
 * under a `server/` or `*.server.ts` convention and check with your Vite
 * config that the import boundary holds.
 *
 * Calling `serverAction()` twice with the same URL replaces the previous
 * registration (last-wins, matches Vite HMR semantics). Calling it from
 * concurrent modules in a single process is undefined behavior — the
 * registry is process-global, not per-request.
 *
 * @example
 * ```ts
 * import { serverAction } from '@purityjs/core';
 *
 * export const saveTodo = serverAction('/api/save-todo', async (request) => {
 *   const data = await request.formData();
 *   const text = String(data.get('text') ?? '');
 *   if (!text) return new Response('text required', { status: 400 });
 *   await db.insert({ text });
 *   // Post-Redirect-Get back to the list page.
 *   return Response.redirect(new URL('/', request.url).toString(), 303);
 * });
 *
 * // In a component (server-only render path):
 * html`<form action=${saveTodo.url} method="POST">
 *   <input name="text" />
 *   <button>Save</button>
 * </form>`;
 * ```
 */
export function serverAction<H extends ServerActionHandler>(
  url: string,
  handler: H,
): ServerAction<H> {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('[Purity] serverAction(): url must be a non-empty string.');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('[Purity] serverAction(): handler must be a function.');
  }
  assertSafeActionUrl(url);
  registry.set(url, handler);
  return {
    url,
    handler,
    async invoke(body, init) {
      if (typeof window === 'undefined' || typeof fetch !== 'function') {
        throw new Error(
          '[Purity] action.invoke() is client-only. ' +
            'On the server, call `action.handler(request)` directly.',
        );
      }
      // Spread init FIRST so explicit defaults (method: POST, body) win
      // over caller-supplied init only when the caller didn't provide
      // them. Previously `...init` came last and could clobber the
      // method default — documented as intentional, but it also meant
      // an `init` without `method` still got POST. Preserve that: only
      // fall back to POST / null body when caller omitted the field.
      // Using `?? 'POST'` / `?? null` is robust against `method: undefined`.
      const method = init?.method ?? 'POST';
      const finalBody =
        init && 'body' in init ? (init.body as BodyInit | null | undefined) : (body ?? null);
      return fetch(url, { ...init, method, body: finalBody });
    },
  };
}

/**
 * Look up a registered handler by request URL path. Returns the handler
 * (not yet invoked) on hit, or `null` on miss.
 *
 * Use this if you want to read the matched handler before dispatching
 * (e.g., to require POST or apply per-route middleware). For the
 * standard "find + invoke + return Response" flow, use {@link handleAction}.
 */
export function findAction(request: Request): ServerActionHandler | null {
  // `new URL()` throws on malformed inputs. A real `Request` always has
  // a valid URL, but `findAction` accepts the structural `Request`
  // shape — a duck-typed mock with `url: ''` (or a relative path)
  // would crash the dispatch path. Catch + return null so the caller
  // falls through to SSR cleanly instead of bubbling a TypeError.
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  // Reject prototype-pollution-style keys defensively. Map.get on
  // '__proto__' / 'constructor' is safe (Map keys are real keys, not
  // property lookups), but if a downstream consumer ever swaps the
  // registry for a plain object, this short-circuit keeps the
  // contract identical. Cheap and unambiguous.
  if (pathname === '__proto__' || pathname === 'constructor' || pathname === 'prototype') {
    return null;
  }
  return registry.get(pathname) ?? null;
}

/**
 * Dispatch the request to its registered handler if one exists. Returns the
 * handler's `Response`, or `null` when no handler matches the URL path so
 * the caller can fall through to SSR or another router.
 *
 * @example
 * ```ts
 * import { handleAction } from '@purityjs/core';
 *
 * // In your server entry, before SSR:
 * const actionResponse = await handleAction(request);
 * if (actionResponse) return actionResponse;
 * // …else render the page normally.
 * ```
 */
export async function handleAction(request: Request): Promise<Response | null> {
  // Method gate: server actions are POST-only by spec (ADR 0012 docs +
  // the example `<form method="POST">` everywhere). Without an explicit
  // check, a GET to /api/save-todo would still dispatch the mutation —
  // a CSRF surface (a `<a href="/api/save-todo">click</a>` from any
  // page could trigger a write). Reject non-POST/PUT/PATCH/DELETE so
  // routing falls through to SSR (which can render a 405 or the page).
  if (
    request.method !== 'POST' &&
    request.method !== 'PUT' &&
    request.method !== 'PATCH' &&
    request.method !== 'DELETE'
  ) {
    return null;
  }
  const handler = findAction(request);
  if (!handler) return null;
  const result = await handler(request);
  // Response brand validation. A handler that returns `undefined` /
  // `null` / a plain object (`{ status: 200 }`) would otherwise leak
  // a non-Response value to the caller, who expects to be able to
  // call `.headers` / `.status` / `.text()` on it. Detect the brand
  // and throw a clear error instead of crashing downstream.
  if (!(result instanceof Response)) {
    throw new TypeError(
      '[Purity] handleAction(): handler must return a Response (got ' +
        (result === null ? 'null' : typeof result) +
        ').',
    );
  }
  return result;
}

/** @internal — clear the action registry. Used by tests; not exported. */
export function _clearActionRegistry(): void {
  registry.clear();
}
