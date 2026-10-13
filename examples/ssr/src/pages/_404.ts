// Root 404 page (ADR 0021). The consumer composer renders this when the
// matchRoute() loop finds no match.

import { currentPath, head } from '@purityjs/core/router';
import { html } from '@purityjs/core/jit';

export default function NotFoundPage(): unknown {
  head(html`<title>Not found — Purity SSR demo</title>`);
  return html`
    <h1>404</h1>
    <p>No route matches <code>${() => currentPath()}</code>.</p>
  `;
}
