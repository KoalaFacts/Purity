// Client entry. The shell DOM is NOT hydrated — only the islands are.
// Each entry is a lazy dynamic-import thunk so Rollup splits each
// island into its own chunk. The shell ships only this file +
// `mountIslands` (a few hundred bytes).
//
// Order matters: the array index must match SSR allocation order
// (Counter first in app.ts → index 0; Like second → index 1).

import { mountIslands } from '@purityjs/core';

mountIslands([
  () => import('./islands/counter.ts').then((m) => m.Counter),
  () => import('./islands/like.ts').then((m) => m.Like),
]);
