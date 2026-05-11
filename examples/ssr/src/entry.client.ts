// Client entry — boots reactivity against the SSR-rendered DOM and wires up
// the canonical SPA navigation stack via `configureNavigation()` (ADR 0027):
//
//   - interceptLinks (ADR 0013) — same-origin <a href> clicks call navigate()
//   - manageNavScroll (ADR 0015) — scroll to hash or top after navigate()
//   - manageNavFocus (ADR 0016) — move focus into <main> after navigate()
//   - manageNavTransitions (ADR 0017) — wrap navigate() in startViewTransition()
//   - prefetchManifestLinks (ADR 0029) — hover-prefetch route modules.
//     Pass the manifest's `routes` array via `prefetch: { routes }`; the
//     consolidator wires the listener for you.

import { configureNavigation, hydrate } from '@purityjs/core';
import { routes } from 'purity:routes';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) hydrate(root, App);
configureNavigation({ prefetch: { routes } });
