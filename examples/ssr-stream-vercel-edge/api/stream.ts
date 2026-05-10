// Vercel Edge Function entry — streams Purity SSR through the standard
// Web Platform Request → Response shape. ADR 0006 Phase 4.
//
// `export const config = { runtime: 'edge' }` opts into the V8 isolate
// runtime (vs the Node.js runtime). No build step beyond what Vercel
// runs automatically.

import { html, resource, suspense } from '@purityjs/core';
import { renderToStream } from '@purityjs/ssr';

export const config = { runtime: 'edge' as const };

function App() {
  return html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Purity SSR streaming — Vercel Edge</title>
      </head>
      <body>
        <main>
          <h1>Hello from Vercel Edge</h1>
          ${suspense(
            () => {
              const fact = resource(
                () =>
                  new Promise<string>((r) =>
                    setTimeout(() => r('Vercel Edge runs on V8 isolates'), 150),
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

export default async function handler(req: Request): Promise<Response> {
  const stream = renderToStream(App, {
    doctype: '<!doctype html>',
    signal: req.signal,
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
