// Root layout (ADR 0020). Wraps every route in the page shell that the
// Worker streams. Receives a `children` accessor; the consumer composer
// (in app.ts) calls it to render the inner route view.

import { html } from '@purityjs/core';

// `<!doctype html>` is prepended by `renderToStream({ doctype })` in
// `worker.ts` so the 404 path (which skips the layout per ADR 0028)
// also ships a valid declaration.
export default function RootLayout(children: () => unknown): unknown {
  return html`
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Purity SSR streaming — Cloudflare Workers</title>
      </head>
      <body>
        <main>
          <nav><a href="/">home</a> · <a href="/stream">/stream</a></nav>
          ${children()}
        </main>
      </body>
    </html>
  `;
}
