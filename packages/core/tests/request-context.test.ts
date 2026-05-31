// @vitest-environment jsdom
// Client-side tests for `getRequest()`. ADR 0009.
// SSR coverage lives in `@purityjs/ssr`'s request-context.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { getRequest } from '../src/index.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

function makeCtx(extra: Partial<SSRRenderContext> = {}): SSRRenderContext {
  return {
    pendingPromises: [],
    resolvedData: [],
    resolvedErrors: [],
    resourceCounter: 0,
    resolvedDataByKey: {},
    resolvedErrorsByKey: {},
    suspenseCounter: 0,
    islandCounter: 0,
    boundaryStartTimes: new Map(),
    boundaryDeadlines: new Map(),
    timedOutBoundaries: new Set(),
    ...extra,
  };
}

describe('getRequest() — client behavior', () => {
  it('returns null when called outside an SSR context', () => {
    expect(getRequest()).toBeNull();
  });
});

describe('getRequest() — SSR context guards (audit-v2)', () => {
  afterEach(() => {
    // Drain any contexts a failing test may have left on the stack so
    // sibling tests aren't poisoned by leftover state.
    while (getRequest() !== null) popSSRRenderContext();
  });

  it('returns null when SSR context has no request bound', () => {
    const ctx = makeCtx();
    pushSSRRenderContext(ctx);
    try {
      expect(getRequest()).toBeNull();
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns the bound Request as-is (reference identity preserved)', () => {
    const req = new Request('https://example.com/p?x=1', {
      headers: { 'x-test': 'yes' },
    });
    const ctx = makeCtx({ request: req });
    pushSSRRenderContext(ctx);
    try {
      const seen = getRequest();
      expect(seen).toBe(req); // ADR 0009 contract: same instance
      expect(seen?.headers.get('x-test')).toBe('yes');
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns null — not a bogus object — when ssrCtx.request is a non-Request value', () => {
    // Simulates a misuse where caller passes a plain object to the SSR
    // renderer instead of a real `Request`. Returning that object would
    // lie about the declared `Request | null` return type and crash
    // any downstream `.headers.get(...)` reader. Guard it in-file.
    const bogus = { url: 'https://evil/', headers: { get: () => 'x' } };
    const ctx = makeCtx({ request: bogus as unknown as Request });
    pushSSRRenderContext(ctx);
    try {
      expect(getRequest()).toBeNull();
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns null when ssrCtx.request is a primitive (string/number/null)', () => {
    for (const junk of ['https://x/', 42, null, true] as unknown[]) {
      const ctx = makeCtx({ request: junk as unknown as Request });
      pushSSRRenderContext(ctx);
      try {
        expect(getRequest()).toBeNull();
      } finally {
        popSSRRenderContext();
      }
    }
  });

  it('reads from the top of the LIFO stack — nested SSR scope wins', () => {
    const outer = new Request('https://outer.example/');
    const inner = new Request('https://inner.example/');
    pushSSRRenderContext(makeCtx({ request: outer }));
    pushSSRRenderContext(makeCtx({ request: inner }));
    try {
      expect(getRequest()).toBe(inner);
      popSSRRenderContext();
      expect(getRequest()).toBe(outer);
    } finally {
      // outer still on stack — pop it
      popSSRRenderContext();
    }
    expect(getRequest()).toBeNull();
  });

  it('does not crash when the global `Request` constructor is unavailable', () => {
    // Some legacy runtimes / sandboxed environments lack `Request`.
    // The guard must degrade to "return null" rather than throwing on
    // `instanceof Request`.
    const originalRequest = (globalThis as { Request?: unknown }).Request;
    // @ts-expect-error — deliberately removing the global for the test
    delete (globalThis as { Request?: unknown }).Request;
    const ctx = makeCtx({ request: { url: 'x' } as unknown as Request });
    pushSSRRenderContext(ctx);
    try {
      expect(() => getRequest()).not.toThrow();
      expect(getRequest()).toBeNull();
    } finally {
      popSSRRenderContext();
      (globalThis as { Request?: unknown }).Request = originalRequest;
    }
  });
});
