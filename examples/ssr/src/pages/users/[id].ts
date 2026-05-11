// /users/:id — `[id]` segment maps to `:id` (ADR 0019). Reads `params.id`
// from its first positional arg. Uses `manageTitle` (ADR 0030) so the tab
// title tracks the current params.id — on SSR it's static; on client SPA
// navigation between `/users/42` → `/users/99` the title updates without
// a re-render of the head from server.

import { html, manageTitle } from '@purityjs/core';

export default function UserProfilePage(params: { id: string }): unknown {
  manageTitle(() => `User ${params.id} — Purity SSR demo`);
  return html`
    <h1>User profile</h1>
    <p>User id: <code>${params.id}</code></p>
  `;
}
