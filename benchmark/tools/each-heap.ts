// Node heap per each() row (CQ-05): mounts 10,000 keyed rows that read their
// item and position, and prints the median retained bytes per row over 7 runs.
// Measures the built packages, so run `npm run build:packages` first.
//
// Usage (from /benchmark): node --expose-gc --experimental-strip-types tools/each-heap.ts

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div></div>');
const g = globalThis as Record<string, unknown> & { gc?: () => void };
if (!g.gc) throw new Error('run with --expose-gc');
const gc = g.gc;
const domGlobals = ['window', 'document', 'Node', 'Text', 'Comment', 'DocumentFragment', 'Element'];
for (let i = 0; i < domGlobals.length; i++) {
  const key = domGlobals[i];
  g[key] = (dom.window as unknown as Record<string, unknown>)[key];
}

const { mount, each } = await import('@purityjs/core');
const { state } = await import('@purityjs/signals');

const ROWS = 10_000;
const RUNS = 7;
const perRow: number[] = [];
for (let run = 0; run < RUNS; run++) {
  const items = state(Array.from({ length: ROWS }, (_, id) => ({ id })));
  const host = document.createElement('div');
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  const app = mount(
    () =>
      each(
        items,
        (item, _index, position) => {
          const row = document.createElement('span');
          row.id = String(item().id + position());
          return row;
        },
        (item) => item.id,
      ) as DocumentFragment,
    host,
  );
  gc();
  gc();
  perRow.push((process.memoryUsage().heapUsed - before) / ROWS);
  app.unmount();
}
perRow.sort((a, b) => a - b);
console.log(
  `each() heap per row: median ${perRow[RUNS >> 1].toFixed(0)} B (runs: ${perRow
    .map((v) => v.toFixed(0))
    .join(', ')})`,
);
