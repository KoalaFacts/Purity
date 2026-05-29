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
});
