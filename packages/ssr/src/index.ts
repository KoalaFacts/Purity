// ---------------------------------------------------------------------------
// @purityjs/ssr — server-side rendering for Purity
//
// This package is Node-only. Importing it from the browser pulls in code
// that has no DOM dependency but no upside either — keep the client bundle
// lean by only loading it from your `entry.server.ts`.
// ---------------------------------------------------------------------------

// Side-effect import: registers the SSR component renderer hook so that
// hyphenated tags in SSR templates dispatch to registered components.
import './component.ts';

export type { SSRHtml } from '@purityjs/core/compiler';
export { html } from './html.ts';
export { type RenderToStreamOptions, renderToStream } from './render-to-stream.ts';
export {
  type RenderStaticOptions,
  type RenderStaticResult,
  type RenderStaticRoute,
  renderStatic,
} from './render-static.ts';
export {
  type RenderToStringOptions,
  type RenderToStringWithHead,
  renderToString,
} from './render-to-string.ts';
