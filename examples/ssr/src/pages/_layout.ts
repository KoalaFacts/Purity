// Root layout (ADR 0020). Wraps every route in a shared `<main>` plus a tiny
// nav. Receives a `children` accessor; the consumer composer (in app.ts)
// calls it to render the inner route view.

import { html } from '@purityjs/core';

export default function RootLayout(children: () => unknown): unknown {
  return html`
    <main>
      <nav>
        <a href="/">home</a> · <a href="/about">about</a> ·
        <a href="/users/42">/users/42</a>
      </nav>
      ${children()}
    </main>
  `;
}
