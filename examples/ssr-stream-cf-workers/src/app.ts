// File-system-routing composer for the Worker. Identical shape to the
// canonical Node SSR example — the manifest is bundler-agnostic, so the
// same `asyncRoute()` / `asyncNotFound()` pattern works under wrangler.
//
// The import path is the on-disk manifest emitted by the Vite plugin
// (ADR 0033 — buildStart eager-emit). Wrangler doesn't run Vite, so the
// virtual `purity:routes` module isn't available; we run `vite build`
// in `prebuild`, which causes the plugin to write `src/.purity/routes.ts`
// without any explicit consumer.

import { asyncNotFound, asyncRoute, matchRoute } from '@purityjs/core';

import { notFoundChain, routes } from './.purity/routes.ts';

export function App(): unknown {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return asyncRoute(entry, m.params);
  }
  return asyncNotFound(notFoundChain);
}
