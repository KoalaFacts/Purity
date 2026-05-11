// Client entry — boots reactivity against the SSR-rendered DOM and wires up
// the canonical SPA navigation stack via `configureNavigation()` (ADR 0027):
//
//   - interceptLinks (ADR 0013) — same-origin <a href> clicks call navigate()
//   - manageNavScroll (ADR 0015) — scroll to hash or top after navigate()
//   - manageNavFocus (ADR 0016) — move focus into <main> after navigate()
//   - manageNavTransitions (ADR 0017) — wrap navigate() in startViewTransition()
//
// All four enabled by default. Opt out per-helper via e.g.
// `configureNavigation({ transitions: false })`, or pass per-helper options
// via the same keys (e.g. `{ focus: { selector: 'main' } }`).

import { configureNavigation, hydrate } from '@purityjs/core';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) hydrate(root, App);
configureNavigation();
