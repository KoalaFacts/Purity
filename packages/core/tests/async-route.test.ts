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

function makeSSRContext(): SSRRenderContext {
  return {
    pendingPromises: [],
    resolvedData: [],
    resolvedErrors: [],
    resourceCounter: 0,
    resolvedDataByKey: {},
    resolvedErrorsByKey: {},
    suspenseCounter: 0,
    boundaryStartTimes: new Map(),
  };
}

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
