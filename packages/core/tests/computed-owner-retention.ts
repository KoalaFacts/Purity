// SV2-015 — retained-heap and owner-cleanup regression for the shared node factory.
// This measures Purity's source-level graph only; it is NOT a paired Solid v2 result.
import assert from 'node:assert/strict';
import { setImmediate as nextJob, setTimeout as delay } from 'node:timers/promises';

import { popContext, pushContext, type Scope } from '@purityjs/signals';
import { compute, disposeScope, state, watch } from '@purityjs/signals';

const gc = globalThis.gc;
assert.ok(gc, 'Run this probe using node --expose-gc');

const rounds = 10;
const nodesPerRound = 4_000;
const maxGrowthBytes = 8 * 1024 * 1024;
const source = state(0);
const heaps: number[] = [];
const creationMs: number[] = [];

for (let round = 0; round < rounds; round++) {
  const owner: Scope = { disposers: null };
  let observed = 0;
  const start = performance.now();

  pushContext(owner);
  try {
    for (let i = 0; i < nodesPerRound; i++) {
      const derived = compute(() => source() + i);
      watch(() => {
        derived();
        observed++;
      });
    }
  } finally {
    popContext();
  }
  creationMs.push(performance.now() - start);
  assert.equal(observed, nodesPerRound, 'New effects must run once eagerly');

  disposeScope(owner);
  const beforeWrite = observed;
  source(round + 1);
  await nextJob();
  assert.equal(observed, beforeWrite, 'Disposed effects must not retain source subscriptions');

  // Yield between explicit collections: WeakRef targets survive their creating
  // job, and FinalizationRegistry callbacks need a chance to release wrappers.
  for (let attempt = 0; attempt < 4; attempt++) {
    gc();
    await delay(20);
  }
  gc();
  heaps.push(process.memoryUsage().heapUsed);
}

const early = heaps.slice(2, 5).sort((a, b) => a - b);
const baseline = early[1];
const growthBytes = Math.max(...heaps.slice(5)) - baseline;
const result = {
  rounds,
  nodesPerRound,
  maxGrowthBytes,
  baseline,
  heaps,
  creationMs,
  growthBytes,
  nodeVersion: process.version,
};
console.log('COMPUTED_OWNER_RETENTION_RESULT ' + JSON.stringify(result));
assert.ok(
  growthBytes <= maxGrowthBytes,
  `Reactive owner churn retained ${growthBytes} bytes (> ${maxGrowthBytes})`,
);
