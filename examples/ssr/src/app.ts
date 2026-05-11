// File-system-routing demo. The plugin scans `src/pages/` (configured in
// vite.config.ts) and emits a virtual `purity:routes` module that this file
// consumes. The whole composer is ADR 0025's `asyncRoute` /
// `asyncNotFound` — every step (route + layout import, loader awaits,
// reduceRight wrap, error-boundary fallback, SSR-multipass registration via
// ADR 0024's lazyResource) lives inside the helper.
//
// What this app exercises end-to-end:
//
//   - ADR 0019 — pattern matching from the manifest.
//   - ADR 0020 — `entry.layouts` chain wrapped via reduceRight.
//   - ADR 0021 — `entry.errorBoundary` rendered on load failure.
//   - ADR 0022 — `entry.hasLoader` / `layout.hasLoader` drive loader calls.
//   - ADR 0023 — `when()` / `each()` are SSR-isomorphic.
//   - ADR 0024 — lazyResource registers with the SSR multipass cycle.
//   - ADR 0025 — the dispatcher is one helper call per match.
//   - ADR 0026 — components read loader data via `loaderData()`.
//   - ADR 0028 — `notFoundChain` picks the nearest `_404.ts` by URL prefix.
//     `/users/missing` lands on `pages/users/_404.ts`; `/missing` lands on
//     `pages/_404.ts`.

import { asyncNotFound, asyncRoute, matchRoute } from '@purityjs/core';
import { notFoundChain, routes } from 'purity:routes';

export function App(): unknown {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return asyncRoute(entry, m.params);
  }
  return asyncNotFound(notFoundChain);
}
