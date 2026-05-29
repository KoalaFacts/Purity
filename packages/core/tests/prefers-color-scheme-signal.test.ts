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
});
