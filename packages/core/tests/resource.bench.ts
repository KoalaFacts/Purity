// ---------------------------------------------------------------------------
// Micro-benchmarks for resource() / lazyResource() / debounced.
//
// Run via `npm run bench -w packages/core`.
// Numbers are reported by vitest in ops/sec (higher is better) plus per-op
// time. Use these to track regressions, not as cross-framework claims.
// ---------------------------------------------------------------------------

import { bench, describe } from 'vitest';
import { debounced } from '../src/debounced.ts';
import { lazyResource, resource } from '../src/resource.ts';
import { state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(() => r()));

describe('resource — construction', () => {
  bench('construct + initial sync resolve', async () => {
    const r = resource(() => 1);
    r.dispose();
  });

  bench('construct + initial async resolve', async () => {
    const r = resource(() => Promise.resolve(1));
    await tick();
    await tick();
    r.dispose();
  });

  bench('construct (source form) + dispose, no fetch', () => {
    const r = resource(
      () => null,
      (k) => Promise.resolve(k),
    );
    r.dispose();
  });
});

describe('resource — fetch round-trip', () => {
  bench('1 dep change → fetch → resolve', async () => {
    const id = state(0);
    const r = resource(
      () => id(),
      (k) => Promise.resolve(k * 2),
    );
    await tick();
    id(1);
    await tick();
    await tick();
    r.dispose();
  });

  bench('10 rapid dep changes → 1 winning resolve', async () => {
    const id = state(0);
    const r = resource(
      () => id(),
      (k) => Promise.resolve(k * 2),
    );
    await tick();
    for (let i = 1; i <= 10; i++) id(i);
    await tick();
    await tick();
    r.dispose();
  });
});

describe('resource — reactive read overhead', () => {
  // Simulates 100 consumers in a template subscribing to r.loading() / r() / r.error().
  bench('100 watchers on a resolved resource', async () => {
    const r = resource(() => Promise.resolve(42));
    await tick();
    const stops: Array<() => void> = [];
    for (let i = 0; i < 100; i++) {
      stops.push(
        watch(() => {
          r();
          r.loading();
          r.error();
        }),
      );
    }
    for (const s of stops) s();
    r.dispose();
  });
});

describe('resource — mutate / refresh', () => {
  bench('mutate(value)', async () => {
    const r = resource(() => Promise.resolve(0));
    await tick();
    r.mutate(99);
    r.dispose();
  });

  bench('refresh() round-trip', async () => {
    const r = resource(() => Promise.resolve(0));
    await tick();
    r.refresh();
    await tick();
    await tick();
    r.dispose();
  });
});

describe('lazyResource', () => {
  bench('construct (no fetch)', () => {
    const r = lazyResource((args: number) => Promise.resolve(args));
    r.dispose();
  });

  bench('fetch(args) → resolve', async () => {
    const r = lazyResource((args: number) => Promise.resolve(args));
    r.fetch(1);
    await tick();
    await tick();
    r.dispose();
  });
});

describe('debounced', () => {
  bench('construct + dispose (no updates)', () => {
    const s = state(0);
    const d = debounced(s, 100);
    void d();
  });

  bench('1 source update (timer scheduled)', async () => {
    const s = state(0);
    const d = debounced(s, 100);
    s(1);
    await tick();
    void d();
  });

  bench('100 rapid source updates (coalesced)', async () => {
    const s = state(0);
    const d = debounced(s, 100);
    for (let i = 1; i <= 100; i++) s(i);
    await tick();
    void d();
  });
});
