// Deno entry — streams Purity SSR through `Deno.serve`. ADR 0006
// Phase 4 + ADRs 0019-0033 (manifest + asyncRoute).
//
// Built by Vite (`vite build`) to `dist/serve.js`. Deno runs the
// built artefact directly with `deno run --allow-net dist/serve.js`.
// The Vite build is needed to AOT-compile every `html\`\`` in the
// page tree into string-builder factories (Deno has no `document`).

import { renderToStream } from '@purityjs/ssr';

import { App } from './app.ts';

// `Deno` is provided by the Deno runtime — declared inline so the
// Vite build's TypeScript pass doesn't choke when `@types/deno` isn't
// installed in the monorepo's node_modules.
declare const Deno: {
  serve(opts: { port: number }, handler: (req: Request) => Response): unknown;
};

Deno.serve({ port: 8000 }, (req: Request): Response => {
  const stream = renderToStream(App, {
    doctype: '<!doctype html>',
    signal: req.signal,
    request: req,
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});
