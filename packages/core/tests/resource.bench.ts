// ---------------------------------------------------------------------------
// Micro-benchmarks for resource() / lazyResource() / debounced.
//
// Run via `npm run bench -w packages/core`.
// Numbers are reported by vitest in ops/sec (higher is better) plus per-op
// time. Use these to track regressions, not as cross-framework claims.
// ---------------------------------------------------------------------------

import { describe, test } from 'vite-plus/test';
import { debounced, type DebouncedAccessor } from '../src/debounced.ts';
import {
  lazyResource,
  type LazyResourceAccessor,
  resource,
  type ResourceAccessor,
} from '../src/resource.ts';
import { state, type StateAccessor, watch } from '../src/signals.ts';
import { tick } from './_helpers.ts';

describe('resource — construction', () => {
  test('construct + initial sync resolve', async ({ bench }) => {
    await bench('construct + initial sync resolve', async () => {
      const r = resource(() => 1);
      r.dispose();
    }).run();
  });

  test('construct + initial async resolve', async ({ bench }) => {
    await bench('construct + initial async resolve', async () => {
      const r = resource(() => Promise.resolve(1));
      await tick();
      await tick();
      r.dispose();
    }).run();
  });

  test('construct (source form) + dispose, no fetch', async ({ bench }) => {
    await bench('construct (source form) + dispose, no fetch', () => {
      const r = resource(
        () => null,
        (k) => Promise.resolve(k),
      );
      r.dispose();
    }).run();
  });
});

describe('resource — fetch round-trip', () => {
  test('1 dep change → fetch → resolve', async ({ bench }) => {
    let id: StateAccessor<number>;
    let r: ResourceAccessor<number>;
    await bench(
      '1 dep change → fetch → resolve',
      {
        beforeAll: async () => {
          id = state(0);
          r = resource(
            () => id(),
            (k) => Promise.resolve(k * 2),
          );
          await tick();
        },
        afterAll: () => r.dispose(),
      },
      async () => {
        id(id.peek() + 1);
        await tick();
        await tick();
      },
    ).run();
  });

  test('10 rapid dep changes → 1 winning resolve', async ({ bench }) => {
    let id: StateAccessor<number>;
    let r: ResourceAccessor<number>;
    await bench(
      '10 rapid dep changes → 1 winning resolve',
      {
        beforeAll: async () => {
          id = state(0);
          r = resource(
            () => id(),
            (k) => Promise.resolve(k * 2),
          );
          await tick();
        },
        afterAll: () => r.dispose(),
      },
      async () => {
        for (let i = 1; i <= 10; i++) id(id.peek() + 1);
        await tick();
        await tick();
      },
    ).run();
  });
});

describe('resource — reactive read overhead', () => {
  test('100 watchers on a resolved resource', async ({ bench }) => {
    let r: ResourceAccessor<number>;
    await bench(
      '100 watchers on a resolved resource',
      {
        beforeAll: async () => {
          r = resource(() => Promise.resolve(42));
          await tick();
        },
        afterAll: () => r.dispose(),
      },
      () => {
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
        for (const stop of stops) stop();
      },
    ).run();
  });
});

describe('resource — mutate / refresh', () => {
  test('mutate(value)', async ({ bench }) => {
    let r: ResourceAccessor<number>;
    await bench(
      'mutate(value)',
      {
        beforeAll: async () => {
          r = resource(() => Promise.resolve(0));
          await tick();
        },
        afterAll: () => r.dispose(),
      },
      () => {
        r.mutate(99);
      },
    ).run();
  });

  test('refresh() round-trip', async ({ bench }) => {
    let r: ResourceAccessor<number>;
    await bench(
      'refresh() round-trip',
      {
        beforeAll: async () => {
          r = resource(() => Promise.resolve(0));
          await tick();
        },
        afterAll: () => r.dispose(),
      },
      async () => {
        r.refresh();
        await tick();
        await tick();
      },
    ).run();
  });
});

describe('lazyResource', () => {
  test('construct (no fetch)', async ({ bench }) => {
    await bench('construct (no fetch)', () => {
      const r = lazyResource((args: number) => Promise.resolve(args));
      r.dispose();
    }).run();
  });

  test('fetch(args) → resolve', async ({ bench }) => {
    let r: LazyResourceAccessor<number, number>;
    await bench(
      'fetch(args) → resolve',
      {
        beforeAll: () => {
          r = lazyResource((args: number) => Promise.resolve(args));
        },
        afterAll: () => r.dispose(),
      },
      async () => {
        r.fetch(1);
        await tick();
        await tick();
      },
    ).run();
  });
});

describe('debounced', () => {
  test('construct + dispose (no updates)', async ({ bench }) => {
    await bench('construct + dispose (no updates)', () => {
      const s = state(0);
      const d = debounced(s, 100);
      d.dispose();
    }).run();
  });

  test('1 source update (timer scheduled)', async ({ bench }) => {
    let s: StateAccessor<number>;
    let d: DebouncedAccessor<number>;
    await bench(
      '1 source update (timer scheduled)',
      {
        beforeAll: () => {
          s = state(0);
          d = debounced(s, 100);
          void d();
        },
        afterAll: () => d.dispose(),
      },
      async () => {
        s(s.peek() + 1);
        await tick();
      },
    ).run();
  });

  test('100 rapid source updates (coalesced)', async ({ bench }) => {
    let s: StateAccessor<number>;
    let d: DebouncedAccessor<number>;
    await bench(
      '100 rapid source updates (coalesced)',
      {
        beforeAll: () => {
          s = state(0);
          d = debounced(s, 100);
          void d();
        },
        afterAll: () => d.dispose(),
      },
      async () => {
        for (let i = 0; i < 100; i++) s(s.peek() + 1);
        await tick();
      },
    ).run();
  });
});
