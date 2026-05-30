// @vitest-environment jsdom
// ADR 0041 — prefersColorSchemeSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prefersColorSchemeSignal } from '../src/index.ts';
import { _resetMediaSignalCache } from '../src/media-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import {
  installMatchMediaMock,
  mockMqls,
  uninstallMatchMediaMock,
  makeSSRContext,
} from './_helpers.ts';

beforeEach(() => {
  _resetMediaSignalCache();
  installMatchMediaMock();
});

afterEach(() => {
  uninstallMatchMediaMock();
  _resetMediaSignalCache();
});

describe('prefersColorSchemeSignal (ADR 0041)', () => {
  it('returns a constant `light` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(prefersColorSchemeSignal()()).toBe('light');
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns `light` when the dark query does not match', () => {
    expect(prefersColorSchemeSignal()()).toBe('light');
  });

  it('returns `dark` when the dark query matches initially', () => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    (mql as unknown as { matches: boolean }).matches = true;
    expect(prefersColorSchemeSignal()()).toBe('dark');
  });

  it('flips on change event', () => {
    const s = prefersColorSchemeSignal();
    expect(s()).toBe('light');
    mockMqls.get('(prefers-color-scheme: dark)')!.setMatches(true);
    expect(s()).toBe('dark');
    mockMqls.get('(prefers-color-scheme: dark)')!.setMatches(false);
    expect(s()).toBe('light');
  });

  // ADR audit-v2 — throw isolation + return value normalization.

  it('falls back to `light` when matchMedia throws synchronously', () => {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = () => {
      throw new Error('boom');
    };
    try {
      // Must not throw; must return a constant `light`.
      const s = prefersColorSchemeSignal();
      expect(s()).toBe('light');
    } finally {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original;
    }
  });

  it('returns `light` when window is undefined-ish (no matchMedia API)', () => {
    const original = window.matchMedia;
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    try {
      const s = prefersColorSchemeSignal();
      expect(s()).toBe('light');
    } finally {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original;
    }
  });

  it('normalizes truthy non-boolean media result to `dark` and falsy to `light`', () => {
    // Defensive: even if the underlying mediaSignal somehow yields a truthy
    // non-boolean (e.g., mocked engine), the mapping should still produce a
    // valid 'dark' | 'light' literal.
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    (mql as unknown as { matches: unknown }).matches = 1 as unknown as boolean;
    // mediaSignal initial read coerces via boolean operator already, so this
    // should produce 'dark'.
    expect(prefersColorSchemeSignal()()).toBe('dark');
  });

  it('falls back to `light` when matchMedia returns a hostile object whose `matches` getter throws', () => {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (q: string) =>
      ({
        media: q,
        get matches(): boolean {
          throw new Error('hostile matches getter');
        },
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList;
    try {
      // Must not throw at the call site, regardless of how mediaSignal copes.
      let s: ReturnType<typeof prefersColorSchemeSignal>;
      expect(() => {
        s = prefersColorSchemeSignal();
      }).not.toThrow();
      expect(() => s!()).not.toThrow();
      expect(s!()).toBe('light');
    } finally {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original;
    }
  });

  it('always returns the literal type `light` | `dark` (no leaking truthy values)', () => {
    // Strict equality — guarantees no accidental boolean / number pass-through.
    expect(prefersColorSchemeSignal()()).toBe('light');
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    (mql as unknown as { matches: boolean }).matches = true;
    const s = prefersColorSchemeSignal();
    const v = s();
    expect(v === 'dark' || v === 'light').toBe(true);
    expect(typeof v).toBe('string');
  });
});
