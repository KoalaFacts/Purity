import { html } from '@purityjs/core';

export const renderMode = 'client';

export default function About(): unknown {
  return html`<main>
    <h1>About</h1>
    <p>This page renders in the browser.</p>
    <a href="/">Home</a>
  </main>`;
}
