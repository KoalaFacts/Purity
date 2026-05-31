// @vitest-environment jsdom
// ADR 0039 — pageVisibilitySignal tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pageVisibilitySignal, watch } from '../src/index.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  _resetPageVisibilitySignal();
  setVisibility('visible');
});

afterEach(() => {
  _resetPageVisibilitySignal();
});

describe('pageVisibilitySignal — SSR (ADR 0039)', () => {
  it('returns `visible` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(pageVisibilitySignal()()).toBe('visible');
    } finally {
      popSSRRenderContext();
    }
  });
});

describe('pageVisibilitySignal — client (ADR 0039)', () => {
  it('reflects document.visibilityState on first read', () => {
    expect(pageVisibilitySignal()()).toBe('visible');
  });

  it('updates on visibilitychange', () => {
    const v = pageVisibilitySignal();
    setVisibility('hidden');
    expect(v()).toBe('hidden');
    setVisibility('visible');
    expect(v()).toBe('visible');
  });

  it('returns the same singleton across calls', () => {
    expect(pageVisibilitySignal()).toBe(pageVisibilitySignal());
  });

  it('participates in reactive tracking', async () => {
    const v = pageVisibilitySignal();
    const seen: string[] = [];
    const dispose = watch(() => seen.push(v()));
    setVisibility('hidden');
    await tick();
    expect(seen).toEqual(['visible', 'hidden']);
    dispose();
  });

  it('registers exactly one visibilitychange listener across many calls', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    for (let i = 0; i < 5; i++) pageVisibilitySignal();
    const calls = addSpy.mock.calls.filter((c) => c[0] === 'visibilitychange');
    expect(calls.length).toBe(1);
    addSpy.mockRestore();
  });

  it('removes the visibilitychange listener on reset (no leak)', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    pageVisibilitySignal();
    _resetPageVisibilitySignal();
    const adds = addSpy.mock.calls.filter((c) => c[0] === 'visibilitychange').length;
    const removes = removeSpy.mock.calls.filter((c) => c[0] === 'visibilitychange').length;
    expect(adds).toBe(1);
    expect(removes).toBe(1);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("coerces non-'visible' visibilityState to 'hidden' (spec convention)", () => {
    // Per the Page Visibility spec, the only values are 'visible' and 'hidden'
    // (with 'prerender' and 'unloaded' historical). Anything not 'visible' must
    // normalize to 'hidden' rather than leak through.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'prerender' as unknown as 'visible',
    });
    const v = pageVisibilitySignal();
    expect(v()).toBe('hidden');
  });

  it("coerces a non-string visibilityState to 'hidden'", () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => null as unknown as 'visible',
    });
    const v = pageVisibilitySignal();
    expect(v()).toBe('hidden');
  });

  it('isolates a throwing visibilityState getter and logs to console.error', () => {
    const v = pageVisibilitySignal();
    expect(v()).toBe('visible');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => {
        throw new Error('boom');
      },
    });
    // Dispatch must not bubble the throw out of the listener.
    expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
    // Old value preserved (refresh is best-effort).
    expect(v()).toBe('visible');
    errSpy.mockRestore();
  });

  it('returns a constant fallback when document.addEventListener is missing', () => {
    const original = document.addEventListener;
    // Simulate a broken document API surface.
    (document as unknown as { addEventListener: unknown }).addEventListener = undefined;
    try {
      const v = pageVisibilitySignal();
      expect(v()).toBe('visible');
    } finally {
      (document as unknown as { addEventListener: typeof original }).addEventListener = original;
    }
  });
});
