import { html } from '@purityjs/core';

export default function NotFound(): unknown {
  return html`<main>
    <h1>Page not found</h1>
    <a href="/">Home</a>
  </main>`;
}
