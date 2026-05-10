// Cloudflare Workers entry — streams Purity SSR through the standard
// Workers `fetch(req, env, ctx)` shape. ADR 0006 Phase 4.
//
// The pattern is platform-agnostic: build a ReadableStream<Uint8Array>
// via `renderToStream`, then wrap it in a `Response`. Wrangler bundles
// this file directly (no Vite/build pipeline needed).

import { html, resource, suspense } from '@purityjs/core';
import { renderToStream } from '@purityjs/ssr';

function App() {
  // Resource inside a suspense() boundary — opt into a key so the
  // per-boundary cache primes the client without refetching on hydrate.
  // In a real Worker the fetcher would be a `fetch()` to your origin,
  // a D1 query, a KV read, etc. The point is just that view awaits
  // this and the shell doesn't.
  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Purity SSR streaming — Cloudflare Workers</title>
      </head>
      <body>
        <main>
          <h1>Hello from Workers</h1>
          ${suspense(
            () => {
              const fact = resource(
                () =>
                  new Promise<string>((r) =>
                    setTimeout(() => r('The Workers runtime started in 2017'), 150),
                  ),
                { initialValue: undefined, key: 'fact' },
              );
              return html`<aside>${() => fact() ?? '…'}</aside>`;
            },
            () => html`<aside class="loading">loading the slow region…</aside>`,
            { timeout: 5000 },
          )}
        </main>
      </body>
    </html>
  `;
}

export default {
  async fetch(req: Request): Promise<Response> {
    const stream = renderToStream(App, {
      doctype: '<!doctype html>',
      // Cancel the renderer when the visitor disconnects mid-stream.
      signal: req.signal,
    });
    return new Response(stream, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
