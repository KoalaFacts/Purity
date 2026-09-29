import { html } from '@purityjs/core';

export const renderMode = 'static';

export default function Post(): unknown {
  return html`<main>
    <h1>Hello</h1>
    <p>A dynamic path generated at build time.</p>
    <a href="/">Home</a>
  </main>`;
}
