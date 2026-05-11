// ADR 0026 — loaderData() context accessor.
//
// Direct unit tests for the push/pop stack semantics + integration
// tests verifying asyncRoute's composer pushes the right slot for each
// component layer (route + each layout + error boundary + 404).

import { describe, expect, it } from 'vitest';

import { asyncNotFound, asyncRoute, type AsyncRouteEntry } from '../src/async-route.ts';
import { loaderData, popLoaderData, pushLoaderData } from '../src/loader-data.ts';
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

function inSSRContext<T>(fn: () => T): { ctx: SSRRenderContext; result: T } {
  const ctx = makeSSRContext();
  pushSSRRenderContext(ctx);
  try {
    return { ctx, result: fn() };
  } finally {
    popSSRRenderContext();
  }
}

describe('loaderData — direct stack semantics (ADR 0026)', () => {
  it('returns undefined when called outside any push/pop scope', () => {
    expect(loaderData()).toBeUndefined();
  });

  it('returns the most recent push', () => {
    pushLoaderData('a');
    try {
      expect(loaderData<string>()).toBe('a');
    } finally {
      popLoaderData();
    }
    expect(loaderData()).toBeUndefined();
  });

  it('stacks nested pushes — outer reads its own slot after inner pops', () => {
    pushLoaderData('outer');
    try {
      expect(loaderData<string>()).toBe('outer');
      pushLoaderData('inner');
      try {
        expect(loaderData<string>()).toBe('inner');
      } finally {
        popLoaderData();
      }
      // Inner popped — outer slot is back on top.
      expect(loaderData<string>()).toBe('outer');
    } finally {
      popLoaderData();
    }
  });

  it('preserves undefined as a valid push value', () => {
    pushLoaderData(undefined);
    try {
      // The slot is `undefined` — loaderData() returns undefined as expected.
      // (No way to distinguish "explicit undefined" from "empty stack" with
      // this API, by design.)
      expect(loaderData()).toBeUndefined();
    } finally {
      popLoaderData();
    }
  });
});

describe('asyncRoute — loaderData() integration (ADR 0026)', () => {
  it('route view sees its own loader data via loaderData()', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => `route:${loaderData<string>() ?? 'NONE'}`,
        loader: async () => 'route-data',
      }),
      layouts: [],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('route:route-data');
  });

  it('layout view sees its own data; nested route view sees its own data', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => `R:${loaderData<string>()}`,
        loader: async () => 'route',
      }),
      layouts: [
        {
          filePath: 'a.ts',
          hasLoader: true,
          importFn: async () => ({
            default: (children: () => unknown) => `L:${loaderData<string>()}(${children()})`,
            loader: async () => 'layout',
          }),
        },
      ],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // Layout sees 'layout'; calling children() runs route which sees 'route'.
    expect(factory()).toBe('L:layout(R:route)');
  });

  it('outer layout sees its own data again after nested children pop', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => `R:${loaderData<string>()}`,
        loader: async () => 'route',
      }),
      layouts: [
        {
          filePath: 'outer.ts',
          hasLoader: true,
          importFn: async () => ({
            default: (children: () => unknown) => {
              const before = loaderData<string>();
              const inner = children();
              const after = loaderData<string>();
              return `${before}|${inner}|${after}`;
            },
            loader: async () => 'outer',
          }),
        },
      ],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    // The outer layout's data is still on top after the inner pops.
    expect(factory()).toBe('outer|R:route|outer');
  });

  it('view sees undefined when its module has no loader (hasLoader unset)', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      // hasLoader omitted.
      importFn: async () => ({
        default: () => `R:${loaderData() ?? 'NONE'}`,
      }),
      layouts: [],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('R:NONE');
  });

  it('error boundary view sees the caught error via loaderData()', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => 'never',
        loader: async () => {
          throw new Error('boom');
        },
      }),
      layouts: [],
      errorBoundary: {
        filePath: '_error.ts',
        importFn: async () => ({
          default: () => `boundary:${(loaderData<Error>() as Error).message}`,
        }),
      },
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(factory()).toBe('boundary:boom');
  });
});

describe('asyncNotFound — loaderData() returns undefined (ADR 0026)', () => {
  it('the 404 page sees undefined since no loader data exists', async () => {
    const entry = {
      filePath: '_404.ts',
      importFn: async () => ({
        default: () => `404:${loaderData() === undefined ? 'NO-DATA' : 'UNEXPECTED'}`,
      }),
    };
    const { ctx } = inSSRContext(() => asyncNotFound(entry));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['notFound:_404.ts'] as () => unknown;
    expect(factory()).toBe('404:NO-DATA');
  });
});

describe('loaderData — push/pop is balanced even when the view throws', () => {
  it('a route view that throws still pops the slot', async () => {
    const entry: AsyncRouteEntry = {
      pattern: '/p',
      filePath: 'p.ts',
      hasLoader: true,
      importFn: async () => ({
        default: () => {
          throw new Error('view threw');
        },
        loader: async () => 'data',
      }),
      layouts: [],
    };
    const { ctx } = inSSRContext(() => asyncRoute(entry, {}));
    await Promise.all(ctx.pendingPromises);
    const factory = ctx.resolvedDataByKey['route:/p'] as () => unknown;
    expect(() => factory()).toThrow('view threw');
    // Stack is back to empty — verifiable by loaderData() returning undefined.
    expect(loaderData()).toBeUndefined();
  });
});
