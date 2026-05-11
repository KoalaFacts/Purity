// Nested 404 (ADR 0028). The plugin's `notFoundChain` puts this entry
// ahead of the root `_404.ts`, so /users/anything-unmatched lands here
// instead of the global 404.

import { currentPath, head, html } from '@purityjs/core';

export default function UsersNotFound(): unknown {
  head(html`<title>User not found — Purity SSR demo</title>`);
  return html`
    <h1>User not found</h1>
    <p>No user matches <code>${() => currentPath()}</code>.</p>
    <p><a href="/users/42">Try /users/42</a></p>
  `;
}
