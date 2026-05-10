// ---------------------------------------------------------------------------
// head(content) — register HTML for the document <head> from inside a
// component during SSR. ADR 0008 Phase 1.
//
// Server: append the rendered HTML to ssrCtx.head[]. Consumed by
//         renderToString({ extractHead: true }) which returns a tuple
//         `{ body, head }` so the caller can splice the captured head
//         markup into their shell template.
// Client: no-op. The browser already parsed the SSR-rendered <head> when
//         the page loaded; client-side mutations are out of scope for
//         Phase 1 (full reactive head element management is a follow-up).
//
// Accepts either an `SSRHtml` value directly or a thunk returning one.
// Other shapes (DOM nodes, raw strings) are also tolerated — the thunk
// is just called once and converted via the shared SSR `valueToHtml`
// coercion so all the usual escaping / branded-SSR-HTML rules apply.
// ---------------------------------------------------------------------------

import { valueToHtml } from './compiler/ssr-runtime.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Register content for the document `<head>` from inside a component.
 *
 * **Server.** The rendered HTML is collected on the current
 * `SSRRenderContext` and surfaced by
 * `renderToString({ extractHead: true })` as `{ body, head }`.
 *
 * **Client.** No-op (Phase 1). The browser already shows the SSR-rendered
 * `<head>`; client-side reactive head element management is a follow-up.
 *
 * @example
 * ```ts
 * import { head, html } from '@purityjs/core';
 *
 * function PageHead({ title, description }: { title: string; description: string }) {
 *   head(html`<title>${title}</title>`);
 *   head(html`<meta name="description" content="${description}">`);
 * }
 *
 * function App() {
 *   return html`
 *     ${PageHead({ title: 'My Page', description: 'Welcome' })}
 *     <main><h1>Hi</h1></main>
 *   `;
 * }
 *
 * // Server
 * const { body, head: headHtml } = await renderToString(App, { extractHead: true });
 * // headHtml = '<title>My Page</title><meta name="description" content="Welcome">'
 * ```
 */
export function head(content: unknown): void {
  const ssrCtx = getSSRRenderContext();
  if (!ssrCtx) return;
  const value = typeof content === 'function' ? (content as () => unknown)() : content;
  const html = valueToHtml(value);
  if (!html) return;
  (ssrCtx.head ??= []).push(html);
}
