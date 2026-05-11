// Root layout (ADR 0020). `<!doctype html>` is prepended by
// `renderToStream({ doctype })` in the Edge handler so the 404 path
// (which skips the layout per ADR 0028) also ships a valid
// declaration.

import { html } from '@purityjs/core';

export default function RootLayout(children: () => unknown): unknown {
  return html`
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Purity SSR streaming — Vercel Edge</title>
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
