// Root layout (ADR 0020). Wraps every route in the page shell that the
// Worker streams. Receives a `children` accessor; the consumer composer
// (in app.ts) calls it to render the inner route view.

import { html } from '@purityjs/core';

export default function RootLayout(children: () => unknown): unknown {
  return html`
    <!doctype html>
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
