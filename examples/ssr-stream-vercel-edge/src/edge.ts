// Vercel Edge Function entry — streams Purity SSR through the standard
// Web Platform Request → Response shape. ADR 0006 Phase 4.
//
// Vite builds this handler to `dist/edge.js`. The tracked `api/stream.js`
// wrapper declares the Edge runtime so Vercel can read it statically;
// `vercel.json` rewrites all paths to that function.

import { renderToStream } from '@purityjs/ssr';

import { App } from './app.ts';

export default async function handler(req: Request): Promise<Response> {
  const stream = renderToStream(App, {
    // The doctype option ships one declaration before the shell. Lives
    // here (vs the layout template) so the 404 path — which skips
    // `_layout.ts` per ADR 0028 — still gets a valid doctype.
    doctype: '<!doctype html>',
    signal: req.signal,
    request: req,
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
