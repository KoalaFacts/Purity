// ---------------------------------------------------------------------------
// @purityjs/ssr — server-side rendering for Purity
//
// This package is Node-only. Importing it from the browser pulls in code
// that has no DOM dependency but no upside either — keep the client bundle
// lean by only loading it from your `entry.server.ts`.
// ---------------------------------------------------------------------------

export type { SSRHtml } from '@purityjs/core/compiler';
export { html } from './html.ts';
export { type RenderToStringOptions, renderToString } from './render-to-string.ts';
