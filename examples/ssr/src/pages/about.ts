// /about — no loader; demonstrates a plain route.

import { head, html } from '@purityjs/core';

export default function AboutPage(): unknown {
  head(html`<title>About — Purity SSR demo</title>`);
  head(html`<meta name="description" content="About this demo." />`);

  return html`
    <h1>About</h1>
    <p>This page is rendered via the file-system route manifest (ADR 0019).</p>
    <p>Try the dynamic route: <a href="/users/42">/users/42</a></p>
  `;
}
