// ---------------------------------------------------------------------------
// getRequest() — read the incoming HTTP Request from inside a component
// during SSR. ADR 0009.
//
// Server: returns the `Request` passed to `renderToString({ request })` or
//         `renderToStream({ request })`, or `null` when none was supplied.
// Client: always returns `null` — there is no incoming request on the
//         client side. Branch on the result if your code is dual-target.
//
// Uses the standard Web Platform `Request` so user code reads `.url`,
// `.method`, `.headers.get('cookie')`, etc. without learning a Purity-
// specific shape. Works identically on Node 18+, Bun, Deno, Cloudflare
// Workers, and Vercel Edge.
// ---------------------------------------------------------------------------

import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Return the incoming `Request` for the current SSR render, or `null`
 * when not in an SSR context (client-side, tests without a request).
 *
 * @example
 * ```ts
 * import { getRequest, head, html } from '@purityjs/core';
 *
 * function PageHead() {
 *   const req = getRequest();
 *   if (!req) return; // client-side render
 *   const url = new URL(req.url);
 *   head(html`<link rel="canonical" href="${url.origin}${url.pathname}">`);
 *
 *   const lang = req.headers.get('accept-language')?.split(',')[0] ?? 'en';
 *   head(html`<meta http-equiv="content-language" content="${lang}">`);
 * }
 * ```
 *
 * @example
 * ```ts
 * // Auth-aware render: components see the request's cookies.
 * function App() {
 *   const req = getRequest();
 *   const session = req?.headers.get('cookie')?.includes('session=') ?? false;
 *   return session ? Dashboard() : SignIn();
 * }
 * ```
 */
export function getRequest(): Request | null {
  const ssrCtx = getSSRRenderContext();
  return ssrCtx?.request ?? null;
}
