// Deno entry — streams Purity SSR through `Deno.serve`. ADR 0006 Phase 4.
//
// Single-file, no build step. Imports use Deno's npm specifier so the
// packages resolve directly from npm on first run.
//
// Run with:
//   deno run --allow-net serve.ts

import { html, resource, suspense } from 'npm:@purityjs/core';
import { renderToStream } from 'npm:@purityjs/ssr';

function App() {
  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Purity SSR streaming — Deno</title>
      </head>
      <body>
        <main>
          <h1>Hello from Deno</h1>
          ${suspense(
            () => {
              const fact = resource(
                () =>
                  new Promise<string>((r) =>
                    setTimeout(() => r('Deno ships with a TypeScript-aware runtime'), 150),
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

Deno.serve({ port: 8000 }, (req: Request): Response => {
  const stream = renderToStream(App, {
    doctype: '<!doctype html>',
    signal: req.signal,
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});
