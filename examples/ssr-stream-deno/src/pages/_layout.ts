import { html } from '@purityjs/core';

export default function RootLayout(children: () => unknown): unknown {
  return html`
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Purity SSR streaming — Deno</title>
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
