// Vercel Edge Function entry — streams Purity SSR through the standard
// Web Platform Request → Response shape. ADR 0006 Phase 4.
//
// `export const config = { runtime: 'edge' }` opts into the V8 isolate
// runtime (vs the Node.js runtime). Vite SSR-builds this file to
// `api/stream.js`; `vercel.json` rewrites all paths to that function.

import { renderToStream } from '@purityjs/ssr';

import { App } from './app.ts';

export const config = { runtime: 'edge' as const };

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
