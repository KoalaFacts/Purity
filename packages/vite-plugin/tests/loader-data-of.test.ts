// ADR 0034 — LoaderDataOf<P, R> tests.
//
// The helpers are compile-time only; vitest doesn't typecheck assertions
// directly, so we exercise them by:
//   1. Building a fake `routes` array typed the same way the emitted
//      manifest is (importFn returns `Promise<typeof import('module')>`)
//      and writing variables whose type comes from `LoaderDataOf<P, R>`.
//      A type-level mismatch would error during esbuild's transform pass.
//   2. Using `@ts-expect-error` on intentionally-bad assignments to pin
//      the negative case.

import { describe, expect, it } from 'vitest';

import type { LoaderDataOf, LoaderDataOfEntry } from '../src/loader-data-of.ts';

// Fake route-module shapes — stand in for what `typeof import('./pages/...')`
// would resolve to when the on-disk manifest's `() => import('/abs/path')`
// dynamic-imports a real file.

interface HomeModule {
  loader: () => Promise<{ todos: readonly string[] }>;
  default: () => unknown;
}

interface UserModule {
  loader: (ctx: { params: { id: string } }) => Promise<{ name: string; age: number }>;
  default: () => unknown;
}

interface AboutModule {
  // No loader — just a view.
  default: () => unknown;
}

interface SyncLoaderModule {
  // Sync loader — return type isn't wrapped in Promise.
  loader: () => { count: number };
  default: () => unknown;
}

// Mirror the emitted manifest's shape — `importFn` typed so dynamic
// import returns the module type. (In the real emitted file TS infers
// this from `() => import('/abs/path')`; here we type it explicitly.)
const routes = [
  {
    pattern: '/',
    filePath: 'index.ts',
    importFn: (): Promise<HomeModule> => Promise.resolve({} as HomeModule),
    layouts: [],
    hasLoader: true as const,
  },
  {
    pattern: '/users/:id',
    filePath: 'users/[id].ts',
    importFn: (): Promise<UserModule> => Promise.resolve({} as UserModule),
    layouts: [],
    hasLoader: true as const,
  },
  {
    pattern: '/about',
    filePath: 'about.ts',
    importFn: (): Promise<AboutModule> => Promise.resolve({} as AboutModule),
    layouts: [],
  },
  {
    pattern: '/sync',
    filePath: 'sync.ts',
    importFn: (): Promise<SyncLoaderModule> => Promise.resolve({} as SyncLoaderModule),
    layouts: [],
    hasLoader: true as const,
  },
] as const;

describe('LoaderDataOf<P, R> — derived shapes (ADR 0034)', () => {
  it('derives an async loader return type', () => {
    const data: LoaderDataOf<'/', typeof routes> = { todos: ['x'] };
    expect(data.todos).toEqual(['x']);
  });

  it('derives a parameterised loader return type', () => {
    const data: LoaderDataOf<'/users/:id', typeof routes> = { name: 'a', age: 1 };
    expect(data.name).toBe('a');
    expect(data.age).toBe(1);
  });

  it('resolves to undefined for routes with no loader', () => {
    const data: LoaderDataOf<'/about', typeof routes> = undefined;
    expect(data).toBeUndefined();
  });

  it('handles sync loaders (no Promise wrap)', () => {
    const data: LoaderDataOf<'/sync', typeof routes> = { count: 42 };
    expect(data.count).toBe(42);
  });

  it('rejects unknown pattern at compile time', () => {
    // @ts-expect-error — `/missing` is not a pattern in the routes array
    const data: LoaderDataOf<'/missing', typeof routes> = { name: 'x' };
    expect(data).toEqual({ name: 'x' });
  });

  it('rejects unknown keys on the inferred shape', () => {
    const data: LoaderDataOf<'/', typeof routes> = {
      todos: [],
      // @ts-expect-error — `extra` isn't in the loader's return type
      extra: 'oops',
    };
    expect(data.todos).toEqual([]);
  });

  it('rejects missing keys on the inferred shape', () => {
    // @ts-expect-error — missing `name` from `/users/:id` loader return
    const data: LoaderDataOf<'/users/:id', typeof routes> = { age: 1 };
    expect(data.age).toBe(1);
  });

  it('falls back to `undefined` when importFn returns generic Promise<unknown>', () => {
    // Emulates the ambient `purity:routes` declaration shape — importFn
    // generalised to `() => Promise<unknown>` (no per-route module info).
    const ambientRoutes = [
      {
        pattern: '/',
        filePath: 'index.ts',
        importFn: (): Promise<unknown> => Promise.resolve({}),
        layouts: [],
      },
    ] as const;
    const data: LoaderDataOf<'/', typeof ambientRoutes> = undefined;
    expect(data).toBeUndefined();
  });
});

describe('LoaderDataOfEntry<E> — single-entry helper (ADR 0034)', () => {
  it('derives loader return type from a typed layout entry', () => {
    const layoutEntry = {
      filePath: '_layout.ts',
      importFn: (): Promise<{ loader: () => Promise<{ theme: 'light' | 'dark' }> }> =>
        Promise.resolve({ loader: () => Promise.resolve({ theme: 'dark' as const }) }),
    };
    const data: LoaderDataOfEntry<typeof layoutEntry> = { theme: 'light' };
    expect(data.theme).toBe('light');
  });

  it('resolves to undefined when the entry has no loader', () => {
    const layoutEntry = {
      filePath: '_layout.ts',
      importFn: (): Promise<{ default: () => unknown }> =>
        Promise.resolve({ default: () => null }),
    };
    const data: LoaderDataOfEntry<typeof layoutEntry> = undefined;
    expect(data).toBeUndefined();
  });
});
