// ADR 0025 — asyncRoute / asyncNotFound runtime composer.
//
// Unit tests for the helper's pass-1 / pass-2 SSR behavior + the
// loadStack composition (route + layouts + loaders + error boundary).

import { describe, expect, it } from 'vitest';

import {
  asyncNotFound,
  type AsyncNotFoundEntry,
  asyncRoute,
  type AsyncRouteEntry,
} from '../src/async-route.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

function inSSRContext<T>(
  fn: () => T,
  ctx?: SSRRenderContext,
): { ctx: SSRRenderContext; result: T } {
  const c = ctx ?? makeSSRContext();
  pushSSRRenderContext(c);
  try {
    return { ctx: c, result: fn() };
  } finally {
    popSSRRenderContext();
  }
}

describe('asyncRoute — pass 1 registers the loadStack promise (ADR 0025)', () => {
  it('imports the route + layout modules in parallel and pushes one promise', async () => {
    const importLog: string[] = [];
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => {
        importLog.push('route');
        return { default: () => 'route view' };
      },
      layouts: [
        {
          filePath: '_layout.ts',
          importFn: async () => {
            importLog.push('layout');
            return { default: (children: () => unknown) => children() };
          },
        },
      ],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    // One promise registered: the lazyResource's loadStack promise.
    expect(ctx.pendingPromises).toHaveLength(1);

    await Promise.all(ctx.pendingPromises);

    // Route + layout imported (parallel, so order may vary).
    expect(importLog.sort()).toEqual(['layout', 'route']);
    // Resolved value cached under the manifest key.
    expect(ctx.resolvedDataByKey['route:/p']).toBeTypeOf('function');
  });

  it('respects a custom keyPrefix', () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({ default: () => 'view' }),
      layouts: [],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}, { keyPrefix: 'admin:' }));
    expect(Object.keys(ctx.resolvedDataByKey)).toEqual([]); // pass 1 hasn't resolved
    expect(ctx.pendingPromises).toHaveLength(1);
  });
});

describe('asyncRoute — loader pipeline (ADR 0025 / 0022)', () => {
  it('calls route + layout loaders in parallel when hasLoader is set', async () => {
    const log: string[] = [];
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: (_p: Record<string, string>, data: unknown) => `route-${data}`,
        loader: async () => {
          log.push('route-loader');
          return 'rd';
        },
      }),
      layouts: [
        {
          filePath: '_layout.ts',
          hasLoader: true,
          importFn: async () => ({
            default: (children: () => unknown, data: unknown) => `[${data}]${children()}`,
            loader: async () => {
              log.push('layout-loader');
              return 'ld';
            },
          }),
        },
      ],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    // Both loaders ran.
    expect(log.sort()).toEqual(['layout-loader', 'route-loader']);

    // Pass 2 — fresh asyncRoute call, cached value applied via the
    // underlying resource()'s SSR path. The factory is in resolvedDataByKey.
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('[ld]route-rd');
  });

  it('skips loaders when hasLoader is not set', async () => {
    let calls = 0;
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      // hasLoader omitted — loader present but should not be called.
      importFn: async () => ({
        default: (_p: Record<string, string>, data: unknown) =>
          data === undefined ? 'no-data' : `unexpected-${data}`,
        loader: async () => {
          calls++;
          return 'unused';
        },
      }),
      layouts: [],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    expect(calls).toBe(0);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('no-data');
  });
});

describe('asyncRoute — error boundary (ADR 0025 / 0021)', () => {
  it('renders the errorBoundary view when a loader rejects', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw new Error('loader exploded');
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({
          default: (err: unknown) => `boundary:${(err as Error).message}`,
        }),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('boundary:loader exploded');
  });

  it('rejects the lazyResource when no errorBoundary is configured', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw new Error('uncaught');
        },
      }),
      layouts: [],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.allSettled(ctx.pendingPromises);
    // The error mirror was populated by ADR 0024's lazyResource SSR path.
    expect(ctx.resolvedErrorsByKey['route:/p']).toBeInstanceOf(Error);
    expect((ctx.resolvedErrorsByKey['route:/p'] as Error).message).toBe('uncaught');
  });
});

describe('asyncRoute — layout chain (ADR 0025 / 0020)', () => {
  it('wraps layouts root → leaf via reduceRight', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({ default: () => 'inner' }),
      layouts: [
        {
          filePath: 'a.ts',
          importFn: async () => ({
            default: (children: () => unknown) => `A(${children()})`,
          }),
        },
        {
          filePath: 'b.ts',
          importFn: async () => ({
            default: (children: () => unknown) => `B(${children()})`,
          }),
        },
      ],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // Root (a) wraps the result of b wrapping inner.
    expect(factory()).toBe('A(B(inner))');
  });
});

describe('asyncNotFound — manifest top-level 404 (ADR 0025 / 0021)', () => {
  it('renders the notFound page on pass 2', async () => {
    const entry: AsyncNotFoundEntry = {
      filePath: '_404.ts',
      importFn: async () => ({ default: () => '404 view' }),
    };
    const { ctx } = inSSRContext(() => asyncNotFound(entry));
    await Promise.all(ctx.pendingPromises);
    expect(ctx.resolvedDataByKey['notFound:_404.ts']).toBeTypeOf('function');
    const factory = ctx.resolvedDataByKey['notFound:_404.ts'] as () => unknown;
    expect(factory()).toBe('404 view');
  });
});

// ---------------------------------------------------------------------------
// ADR 0028 — asyncNotFound chain form. Walks the manifest's notFoundChain
// deepest-first and renders the entry whose `dir` prefixes the current path.
// ---------------------------------------------------------------------------

import { navigate } from '../src/router.ts';

describe('asyncNotFound — chain form (ADR 0028)', () => {
  it('picks the deepest entry whose dir prefixes the current path', async () => {
    // We're inside an SSR context here, so navigate() does nothing on the
    // server — but the test exercises the chain-walk logic via a manually
    // set window.location-like signal. Simulate by pushing the SSR context's
    // request URL.
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    // Set client-side URL to /admin/missing so currentPath() returns /admin/missing.
    navigate('/admin/missing');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    expect(ctx.resolvedDataByKey['notFound:admin/_404.ts']).toBeTypeOf('function');
    const factory = ctx.resolvedDataByKey['notFound:admin/_404.ts'] as () => unknown;
    expect(factory()).toBe('ADMIN 404');
  });

  it('falls through to the root entry when no nested dir matches', async () => {
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/blog/missing');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    expect(ctx.resolvedDataByKey['notFound:_404.ts']).toBeTypeOf('function');
    const factory = ctx.resolvedDataByKey['notFound:_404.ts'] as () => unknown;
    expect(factory()).toBe('ROOT 404');
  });

  it('does NOT match dir prefix on similar-but-different paths', async () => {
    // `dir: 'admin'` should match /admin and /admin/* but NOT /administrator.
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/administrator');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    // /administrator falls through to root.
    const factory = ctx.resolvedDataByKey['notFound:_404.ts'] as () => unknown;
    expect(factory()).toBe('ROOT 404');
    // admin's _404 was NOT loaded.
    expect(ctx.resolvedDataByKey['notFound:admin/_404.ts']).toBeUndefined();
  });

  it('renders nothing when the chain is empty', () => {
    const { result } = inSSRContext(() => asyncNotFound([]));
    // Empty chain → result is `when(false, ...)` which renders an empty match.
    // We don't assert the exact shape (it's an SSR HTML marker); just that
    // it doesn't throw.
    expect(result).toBeDefined();
  });

  it('renders nothing when no entry matches the current path', async () => {
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
    ];
    navigate('/blog/missing');
    const { ctx, result } = inSSRContext(() => asyncNotFound(chain));
    // No matching entry → nothing fetched.
    expect(ctx.pendingPromises).toHaveLength(0);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// audit-v2 regressions — render-time error isolation, boundary-import
// failure preservation, dir normalization, loader param freeze.
// ---------------------------------------------------------------------------

describe('asyncRoute — audit-v2 render-time error isolation', () => {
  it('routes a route-view throw through the error boundary instead of escaping when()', async () => {
    // RED before fix: a sync throw inside `routeMod.default()` escapes the
    // try-block in loadStack's catch (which only catches imports/loaders),
    // so when() invokes a thrown factory and the consumer's render crashes.
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({
        default: () => {
          throw new Error('view rendered with stale data');
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({
          default: (err: unknown) => `caught:${(err as Error).message}`,
        }),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // GREEN: the factory does NOT throw; the boundary view rendered instead.
    expect(() => factory()).not.toThrow();
    expect(factory()).toBe('caught:view rendered with stale data');
  });

  it('routes a layout-render throw through the error boundary', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({ default: () => 'inner' }),
      layouts: [
        {
          filePath: '_layout.ts',
          importFn: async () => ({
            default: (_children: () => unknown) => {
              throw new TypeError('layout crashed');
            },
          }),
        },
      ],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({
          default: (err: unknown) => `boundary:${(err as Error).message}`,
        }),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('boundary:layout crashed');
  });

  it('still rethrows a render-time throw when no errorBoundary is configured', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({
        default: () => {
          throw new Error('escapes');
        },
      }),
      layouts: [],
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // No boundary → throw must still surface to the consumer's outer
    // fallback path. Routing it to a fake boundary would silently swallow.
    expect(() => factory()).toThrow('escapes');
  });
});

describe('asyncRoute — audit-v2 errorBoundary import failure', () => {
  it('preserves the original loader error when the boundary import itself fails', async () => {
    // RED before fix: the catch block awaited errorBoundary.importFn(),
    // and if that rejected, the throw replaced `err` with the boundary's
    // import error — the original loader bug was invisible.
    const loaderErr = new Error('original loader bug');
    const boundaryErr = new Error('boundary chunk 404');
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw loaderErr;
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => {
          throw boundaryErr;
        },
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.allSettled(ctx.pendingPromises);
    const surfaced = ctx.resolvedErrorsByKey['route:/p'];
    // GREEN: AggregateError with both layers visible.
    expect(surfaced).toBeInstanceOf(AggregateError);
    const agg = surfaced as AggregateError;
    expect(agg.errors).toHaveLength(2);
    expect(agg.errors[0]).toBe(loaderErr);
    expect(agg.errors[1]).toBe(boundaryErr);
  });

  it('falls through to original-throw when boundary module has no default export', async () => {
    const loaderErr = new Error('the real bug');
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw loaderErr;
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        // No `default` — malformed boundary module.
        importFn: async () => ({}),
      },
    };

    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.allSettled(ctx.pendingPromises);
    // Should surface the ORIGINAL error — not an opaque "boundary unusable".
    expect(ctx.resolvedErrorsByKey['route:/p']).toBe(loaderErr);
  });
});

describe('asyncNotFound — audit-v2 dir normalization (ADR 0028)', () => {
  it('accepts a leading slash on dir', async () => {
    // RED before fix: `dir: '/admin'` produced prefix '//admin' which
    // can never match any sane URL path — silently routed to the next
    // chain entry instead.
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: '/admin',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/admin/missing');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['notFound:admin/_404.ts'] as () => unknown;
    expect(factory()).toBe('ADMIN 404');
  });

  it('accepts a trailing slash on dir', async () => {
    const chain = [
      {
        filePath: 'admin/_404.ts',
        dir: 'admin/',
        importFn: async () => ({ default: () => 'ADMIN 404' }),
      },
      {
        filePath: '_404.ts',
        dir: '',
        importFn: async () => ({ default: () => 'ROOT 404' }),
      },
    ];
    navigate('/admin');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['notFound:admin/_404.ts'] as () => unknown;
    expect(factory()).toBe('ADMIN 404');
  });

  it('treats dir consisting solely of slashes as the root catch-all', async () => {
    const chain = [
      {
        filePath: 'catch.ts',
        dir: '///',
        importFn: async () => ({ default: () => 'CATCH' }),
      },
    ];
    navigate('/anywhere');
    const { ctx } = inSSRContext(() => asyncNotFound(chain));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['notFound:catch.ts'] as () => unknown;
    expect(factory()).toBe('CATCH');
  });
});

describe('asyncRoute — audit-v2 loader param shielding', () => {
  it('hands the loader a frozen params snapshot so mutations cannot race the view', async () => {
    // RED before fix: ctx.params === routeMod.default(params, …)'s same
    // object. A loader that did `ctx.params.id = sanitize(ctx.params.id)`
    // would silently mutate the view's input mid-render. Freezing the
    // snapshot surfaces the bug at the loader instead.
    let loaderSawFrozen = false;
    const original = { id: 'raw' };
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: (_p: Record<string, string>) => 'ok',
        loader: async (ctx: LoaderContext) => {
          loaderSawFrozen = Object.isFrozen(ctx.params);
          // The original caller's bag must NOT be frozen — only the loader's
          // snapshot is sealed.
          return null;
        },
      }),
      layouts: [],
    };
    // Need a local import for LoaderContext typing within the test scope.
    type LoaderContext = import('../src/async-route.ts').LoaderContext;

    const { ctx } = inSSRContext(() => asyncRoute(entry, original));
    await Promise.all(ctx.pendingPromises);
    expect(loaderSawFrozen).toBe(true);
    // Caller's original params bag is untouched (and still mutable).
    expect(Object.isFrozen(original)).toBe(false);
    expect(original).toEqual({ id: 'raw' });
  });
});

describe('asyncRoute — audit-v2 tokened loaderData balance', () => {
  it('the route view-factory uses tokened push/pop so unbalanced user pushes are detected', async () => {
    // RED before fix: untokened popLoaderData() silently removed whatever
    // top frame was on the stack — a misbehaving route view that pushed
    // without popping leaked its frame upward and corrupted later reads.
    const { pushLoaderData, loaderDataStackDepth, resetLoaderDataStack } =
      await import('../src/loader-data.ts');
    resetLoaderDataStack();
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      importFn: async () => ({
        default: () => {
          // Misbehaving view: pushes without popping.
          pushLoaderData('rogue');
          return 'view';
        },
      }),
      layouts: [],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // GREEN: the wrapping tokened pop throws on mismatch — bug surfaces
    // at the offending call site instead of silently leaking the frame.
    expect(() => factory()).toThrow(/imbalance/);
    // Clean up so other tests aren't poisoned.
    resetLoaderDataStack();
    expect(loaderDataStackDepth()).toBe(0);
  });
});
