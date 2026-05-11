// Root error boundary (ADR 0021). The consumer composer wraps the route +
// loader in try/catch and calls this with the thrown error on failure.

import { head, html } from '@purityjs/core';

export default function RootError(error: unknown): unknown {
  head(html`<title>Error — Purity SSR demo</title>`);
  return html`
    <h1>Something went wrong</h1>
    <p><code>${String((error as { message?: string })?.message ?? error)}</code></p>
    <p>Reload the page to retry.</p>
  `;
}
