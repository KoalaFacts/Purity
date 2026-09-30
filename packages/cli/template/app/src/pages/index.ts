import { html } from '@purityjs/core';

export const renderMode = 'static';

export default function Home(): unknown {
  return html`<main>
    <h1>Purity app</h1>
    <p>This page was generated at build time.</p>
    <nav>
      <a href="/about">About</a> · <a href="/time">Time</a> · <a href="/posts/hello">Post</a>
      · <a href="/greeting">Greeting</a>
    </nav>
  </main>`;
}
