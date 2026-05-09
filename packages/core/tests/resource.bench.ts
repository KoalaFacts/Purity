// ---------------------------------------------------------------------------
// Micro-benchmarks for resource() / lazyResource() / debounced.
//
// Run via `npm run bench -w packages/core`.
// Numbers are reported by vitest in ops/sec (higher is better) plus per-op
// time. Use these to track regressions, not as cross-framework claims.
// ---------------------------------------------------------------------------

import { bench, describe } from 'vitest';
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
  let id: StateAccessor<number>;
  let r: ResourceAccessor<number>;

  bench(
    '1 dep change → fetch → resolve',
    async () => {
      id(id.peek() + 1);
      await tick();
      await tick();
    },
    {
      setup: async () => {
        id = state(0);
        r = resource(
          () => id(),
          (k) => Promise.resolve(k * 2),
        );
        await tick();
      },
      teardown: () => r.dispose(),
    },
  );

  bench(
    '10 rapid dep changes → 1 winning resolve',
    async () => {
      for (let i = 1; i <= 10; i++) id(id.peek() + 1);
      await tick();
      await tick();
    },
    {
      setup: async () => {
        id = state(0);
        r = resource(
          () => id(),
          (k) => Promise.resolve(k * 2),
        );
        await tick();
      },
      teardown: () => r.dispose(),
    },
  );
});

describe('resource — reactive read overhead', () => {
  let r: ResourceAccessor<number>;
  let stops: Array<() => void> = [];

  bench(
    '100 watchers on a resolved resource',
    () => {
      stops = [];
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
    },
    {
      setup: async () => {
        r = resource(() => Promise.resolve(42));
        await tick();
      },
      teardown: () => r.dispose(),
    },
  );
});

describe('resource — mutate / refresh', () => {
  let r: ResourceAccessor<number>;

  bench(
    'mutate(value)',
    () => {
      r.mutate(99);
    },
    {
      setup: async () => {
        r = resource(() => Promise.resolve(0));
        await tick();
      },
      teardown: () => r.dispose(),
    },
  );

  bench(
    'refresh() round-trip',
    async () => {
      r.refresh();
      await tick();
      await tick();
    },
    {
      setup: async () => {
        r = resource(() => Promise.resolve(0));
        await tick();
      },
      teardown: () => r.dispose(),
    },
  );
});

describe('lazyResource', () => {
  bench('construct (no fetch)', () => {
    const r = lazyResource((args: number) => Promise.resolve(args));
    r.dispose();
  });

  let r: LazyResourceAccessor<number, number>;
  bench(
    'fetch(args) → resolve',
    async () => {
      r.fetch(1);
      await tick();
      await tick();
    },
    {
      setup: () => {
        r = lazyResource((args: number) => Promise.resolve(args));
      },
      teardown: () => r.dispose(),
    },
  );
});

describe('debounced', () => {
  bench('construct + dispose (no updates)', () => {
    const s = state(0);
    const d = debounced(s, 100);
    d.dispose();
  });

  let s: StateAccessor<number>;
  let d: DebouncedAccessor<number>;

  bench(
    '1 source update (timer scheduled)',
    async () => {
      s(s.peek() + 1);
      await tick();
    },
    {
      setup: () => {
        s = state(0);
        d = debounced(s, 100);
        void d();
      },
      teardown: () => d.dispose(),
    },
  );

  bench(
    '100 rapid source updates (coalesced)',
    async () => {
      for (let i = 0; i < 100; i++) s(s.peek() + 1);
      await tick();
    },
    {
      setup: () => {
        s = state(0);
        d = debounced(s, 100);
        void d();
      },
      teardown: () => d.dispose(),
    },
  );
});
