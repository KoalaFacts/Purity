import { asyncNotFound, asyncRoute, matchRoute } from '@purityjs/core';

import { notFoundChain, routes } from './.purity/routes.ts';

export function App(): unknown {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return asyncRoute(entry, m.params);
  }
  return asyncNotFound(notFoundChain);
}
