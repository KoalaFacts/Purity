import { html } from '@purityjs/core';

export const renderMode = 'server';

export default function Time(): unknown {
  return html`<main>
    <h1>Time</h1>
    <p>Rendered on each request.</p>
    <a href="/">Home</a>
  </main>`;
}
