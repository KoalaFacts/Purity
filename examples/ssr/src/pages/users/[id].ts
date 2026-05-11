// /users/:id — `[id]` segment maps to `:id` (ADR 0019). The view annotates
// its params via `RouteParams<'/users/:id'>` (ADR 0031) so `params.id` is
// `string` (narrow) instead of `string | undefined` (the generic
// matchRoute() shape). Also uses `manageTitle` (ADR 0030) so the tab
// title updates on SPA navigation between /users/42 and /users/99.

import { html, manageTitle } from '@purityjs/core';
import type { RouteParams } from '@purityjs/vite-plugin';

export default function UserProfilePage(params: RouteParams<'/users/:id'>): unknown {
  manageTitle(() => `User ${params.id} — Purity SSR demo`);
  return html`
    <h1>User profile</h1>
    <p>User id: <code>${params.id}</code></p>
  `;
}
