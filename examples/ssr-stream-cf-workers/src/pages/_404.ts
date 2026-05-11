// Root 404 page (ADR 0021/0028). asyncNotFound(notFoundChain) lands here
// when matchRoute() finds no entry.

import { currentPath, head, html } from '@purityjs/core';

export default function NotFoundPage(): unknown {
  head(html`<title>Not found</title>`);
  return html`
    <h1>404</h1>
    <p>No route matches <code>${() => currentPath()}</code>.</p>
  `;
}
