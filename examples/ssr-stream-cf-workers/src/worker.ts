// Cloudflare Workers entry — streams Purity SSR through the standard
// Workers `fetch(req, env, ctx)` shape. ADR 0006 Phase 4 + ADR 0033.
//
// The pattern is platform-agnostic: build a ReadableStream<Uint8Array>
// via `renderToStream`, then wrap it in a `Response`. Wrangler bundles
// `worker.ts` directly (no Vite/build pipeline), so the route manifest
// is consumed via the on-disk file `vite build` emits before deploy
// (`src/.purity/routes.ts`, ADR 0033 buildStart eager-emit).

import { renderToStream } from '@purityjs/ssr';

import { App } from './app.ts';

export default {
  async fetch(req: Request): Promise<Response> {
    const stream = renderToStream(App, {
      // The doctype option prepends one declaration before the shell.
      // Keep it here (vs inside the layout template) so the 404 path —
      // which doesn't go through `_layout.ts` per ADR 0028 — still
      // gets a valid doctype.
      doctype: '<!doctype html>',
      // Cancel the renderer when the visitor disconnects mid-stream.
      signal: req.signal,
      // The manifest's `asyncRoute()` reads `getRequest()` to source
      // `params` / cookies — pass the real Request through so loaders
      // see per-request context.
      request: req,
    });
    return new Response(stream, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
