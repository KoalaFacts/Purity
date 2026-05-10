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
}

const registry = new Map<string, ServerActionHandler>();

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
  registry.set(url, handler);
  return { url, handler };
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
  const pathname = new URL(request.url).pathname;
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
  const handler = findAction(request);
  if (!handler) return null;
  return handler(request);
}

/** @internal — clear the action registry. Used by tests; not exported. */
export function _clearActionRegistry(): void {
  registry.clear();
}
