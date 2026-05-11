// /users/:id — `[id]` segment maps to `:id` (ADR 0019). Reads `params.id`
// from its first positional arg.

import { head, html } from '@purityjs/core';

export default function UserProfilePage(params: { id: string }): unknown {
  head(html`<title>User ${params.id} — Purity SSR demo</title>`);
  return html`
    <h1>User profile</h1>
    <p>User id: <code>${params.id}</code></p>
  `;
}
