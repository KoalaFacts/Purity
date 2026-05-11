// Manifest-driven composer — identical to the cf-workers example.
// `./.purity/routes.ts` is written by `@purityjs/vite-plugin`'s
// buildStart hook (ADR 0033) on every `vite build` / `vite dev`.

import { asyncNotFound, asyncRoute, matchRoute } from '@purityjs/core';

import { notFoundChain, routes } from './.purity/routes.ts';

export function App(): unknown {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return asyncRoute(entry, m.params);
  }
  return asyncNotFound(notFoundChain);
}
