import { asyncNotFound, asyncRoute, matchRoute } from '@purityjs/core';
import { notFoundChain, routes } from 'purity:routes';

export function App(): unknown {
  for (const entry of routes) {
    const match = matchRoute(entry.pattern);
    if (match) return asyncRoute(entry, match.params);
  }
  return asyncNotFound(notFoundChain);
}
