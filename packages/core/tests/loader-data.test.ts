// ADR 0026 — loaderData() context accessor.
//
// Direct unit tests for the push/pop stack semantics + integration
// tests verifying asyncRoute's composer pushes the right slot for each
// component layer (route + each layout + error boundary + 404).

import { afterEach, describe, expect, it } from 'vitest';

import { asyncNotFound, asyncRoute, type AsyncRouteEntry } from '../src/async-route.ts';
import {
  loaderData,
  loaderDataStackDepth,
  popLoaderData,
  pushLoaderData,
  resetLoaderDataStack,
} from '../src/loader-data.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

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

// ---------------------------------------------------------------------------
// audit-v2 in-file hardening regressions.
// ---------------------------------------------------------------------------

describe('loaderData — audit-v2 hardening', () => {
  afterEach(() => {
    // Each hardening test verifies its own balance, but if any assertion
    // fails mid-scope we don't want to bleed frames into the next test.
    resetLoaderDataStack();
  });

  it('pushLoaderData returns an opaque token that popLoaderData accepts', () => {
    const token = pushLoaderData('a');
    expect(typeof token).toBe('number');
    expect(loaderData<string>()).toBe('a');
    // Passing the matching token pops cleanly.
    popLoaderData(token);
    expect(loaderData()).toBeUndefined();
    expect(loaderDataStackDepth()).toBe(0);
  });

  it('popLoaderData is a no-op on an empty stack (defensive against double-pop)', () => {
    // RED: without the guard, this would push the array length to -1 via
    // Array.pop and corrupt the next push's index calculation. We just
    // assert no throw and a stable depth.
    expect(loaderDataStackDepth()).toBe(0);
    popLoaderData();
    popLoaderData(); // double-pop while empty
    expect(loaderDataStackDepth()).toBe(0);
    // And subsequent push/pop still behaves correctly.
    const t = pushLoaderData('after-empty-pop');
    expect(loaderData<string>()).toBe('after-empty-pop');
    popLoaderData(t);
    expect(loaderDataStackDepth()).toBe(0);
  });

  it('popLoaderData throws when token does not match the top frame (catches imbalance)', () => {
    // Simulates a missed-pop bug: outer push, inner push, but the outer
    // tries to pop with its own token while the inner is still on top.
    // Without the guard, the outer would pop the inner's slot and leak
    // the outer's data into the next scope. With the guard, the bug
    // surfaces at the offending call instead of corrupting later reads.
    const outer = pushLoaderData('outer');
    pushLoaderData('inner-leaked'); // intentionally not popped
    expect(() => popLoaderData(outer)).toThrow(/imbalance/);
    // Stack is intentionally NOT popped on imbalance — top frame still
    // belongs to the inner caller.
    expect(loaderData<string>()).toBe('inner-leaked');
  });

  it('mismatched-token throw does not corrupt the stack — clean-up via subsequent matched pops', () => {
    const outer = pushLoaderData({ scope: 'outer' });
    const inner = pushLoaderData({ scope: 'inner' });
    // Attempt to pop outer first — throws and leaves both frames intact.
    expect(() => popLoaderData(outer)).toThrow();
    expect(loaderDataStackDepth()).toBe(2);
    // Now pop in the correct order — both succeed.
    popLoaderData(inner);
    popLoaderData(outer);
    expect(loaderDataStackDepth()).toBe(0);
    expect(loaderData()).toBeUndefined();
  });

  it('token-less popLoaderData remains backwards-compatible (async-route call site)', () => {
    // async-route.ts calls popLoaderData() with no arg. That has to keep
    // working — we just lose the imbalance check.
    pushLoaderData('legacy');
    expect(loaderData<string>()).toBe('legacy');
    popLoaderData();
    expect(loaderData()).toBeUndefined();
  });

  it('resetLoaderDataStack discards every frame (recovery path)', () => {
    pushLoaderData('a');
    pushLoaderData('b');
    pushLoaderData('c');
    expect(loaderDataStackDepth()).toBe(3);
    resetLoaderDataStack();
    expect(loaderDataStackDepth()).toBe(0);
    expect(loaderData()).toBeUndefined();
  });

  it('frame ids are unique within a realistic batch — distinct tokens for separate pushes', () => {
    // Guards against a regression that would assign the same id to two
    // frames (which would let an inner pop accidentally match the outer
    // token after the inner was already popped, defeating the guard).
    const ids = new Set<number>();
    for (let i = 0; i < 1000; i++) ids.add(pushLoaderData(i));
    expect(ids.size).toBe(1000);
    // Unwind without imbalance.
    for (let i = 0; i < 1000; i++) popLoaderData();
    expect(loaderDataStackDepth()).toBe(0);
  });

  it('loaderData reads the value field of the top frame (not the frame object)', () => {
    // Regression for the refactor that wraps the slot in `{ id, value }`.
    // loaderData<T>() must still return the bare value, not the frame.
    const payload = { user: 'alice' };
    pushLoaderData(payload);
    try {
      const read = loaderData<{ user: string }>();
      expect(read).toBe(payload);
      expect(read?.user).toBe('alice');
    } finally {
      popLoaderData();
    }
  });
});
