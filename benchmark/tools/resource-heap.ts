#!/usr/bin/env node
// Heap-allocation profiler for resource() / lazyResource() / debounced.
//
// Measures per-cycle heap delta for typical resource lifecycles. Forces GC
// between samples (requires --expose-gc).
//
// Usage:
//   cd benchmark && node --expose-gc --conditions=development tools/resource-heap.ts
//
// Reports retained heap bytes after one cycle (which should be ~0 if the
// implementation cleans up). Numbers are noisy by ±a few KB because of V8
// internal bookkeeping; the trend across cycles is what matters.

import { debounced, lazyResource, resource, state } from '../../packages/core/src/index.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

if (typeof global.gc !== 'function') {
  console.error('Run with: node --expose-gc tools/resource-heap.ts');
  process.exit(1);
}

async function settle() {
  // Drain microtasks then macrotasks, then double-GC.
  for (let i = 0; i < 5; i++) await tick();
  await sleep(10);
  global.gc();
  global.gc();
}

interface Cycle {
  r: { dispose: () => void };
  run: () => Promise<void> | void;
}

async function measureCycle(label: string, factory: () => Cycle, cycles = 1000): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const c = factory();
    await c.run();
    c.r.dispose();
  }
  await settle();

  const before = process.memoryUsage().heapUsed;

  const refs: Cycle['r'][] = [];
  for (let i = 0; i < cycles; i++) {
    const c = factory();
    await c.run();
    refs.push(c.r);
  }
  for (const r of refs) r.dispose();
  refs.length = 0;
  await settle();

  const after = process.memoryUsage().heapUsed;
  const deltaTotal = after - before;
  const perCycle = deltaTotal / cycles;
  console.log(
    `${label.padEnd(50)} ${perCycle >= 0 ? '+' : ''}${perCycle.toFixed(1).padStart(8)} B/cycle  (Δheap ${(deltaTotal / 1024).toFixed(1)} KB over ${cycles} cycles)`,
  );
}

async function main() {
  console.log('\nResource heap-allocation profile');
  console.log('-'.repeat(82));

  await measureCycle('resource() construct + sync resolve + dispose', () => {
    const r = resource(() => 1);
    return { r, run: () => Promise.resolve() };
  });

  await measureCycle('resource() construct + async resolve + dispose', () => {
    const r = resource(() => Promise.resolve(1));
    return {
      r,
      run: async () => {
        await tick();
        await tick();
      },
    };
  });

  await measureCycle('resource(source, fetcher) one fetch cycle + dispose', () => {
    const id = state(1);
    const r = resource(
      () => id(),
      (k) => Promise.resolve(k * 2),
    );
    return {
      r,
      run: async () => {
        await tick();
        id(2);
        await tick();
        await tick();
      },
    };
  });

  await measureCycle('lazyResource() construct + fetch + dispose', () => {
    const r = lazyResource((args: number) => Promise.resolve(args));
    return {
      r,
      run: async () => {
        r.fetch(1);
        await tick();
        await tick();
      },
    };
  });

  await measureCycle('debounced() construct + 10 updates + flush', () => {
    const s = state(0);
    const d = debounced(s, 1);
    return {
      r: d,
      run: async () => {
        for (let i = 1; i <= 10; i++) s(i);
        await sleep(5);
        void d();
      },
    };
  });

  console.log('-'.repeat(82));
  console.log(
    '\nA value near zero means the object lifecycle is a closed loop —\nresource creation and disposal cancel out at the heap level.\n',
  );
}

await main();
