// @vitest-environment jsdom
// ADR 0041 — prefersReducedMotionSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prefersReducedMotionSignal } from '../src/index.ts';
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

describe('prefersReducedMotionSignal (ADR 0041)', () => {
  it('returns a constant `false` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(prefersReducedMotionSignal()()).toBe(false);
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns the matchMedia result', () => {
    const s = prefersReducedMotionSignal();
    expect(s()).toBe(false);
    mockMqls.get('(prefers-reduced-motion: reduce)')!.setMatches(true);
    expect(s()).toBe(true);
    mockMqls.get('(prefers-reduced-motion: reduce)')!.setMatches(false);
    expect(s()).toBe(false);
  });

  // ADR audit-v2 — throw isolation + missing-API fallback + result coercion.

  it('falls back to `false` when matchMedia throws synchronously', () => {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = () => {
      throw new Error('boom');
    };
    try {
      // Constructor must not throw; accessor returns the SSR-equivalent constant.
      const s = prefersReducedMotionSignal();
      expect(s()).toBe(false);
    } finally {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original;
    }
  });

  it('returns `false` when window.matchMedia is unavailable', () => {
    const original = window.matchMedia;
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    try {
      const s = prefersReducedMotionSignal();
      expect(s()).toBe(false);
    } finally {
      (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = original;
    }
  });

  it('always returns a strict boolean (truthy non-bool coerces to true)', () => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    (mql as unknown as { matches: unknown }).matches = 1 as unknown as boolean;
    const v = prefersReducedMotionSignal()();
    expect(typeof v).toBe('boolean');
    expect(v).toBe(true);
  });
});
