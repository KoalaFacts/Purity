// @vitest-environment jsdom
// ADR 0041 — prefersContrastSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prefersContrastSignal } from '../src/index.ts';
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

describe('prefersContrastSignal (ADR 0041)', () => {
  it('returns a constant `no-preference` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(prefersContrastSignal()()).toBe('no-preference');
    } finally {
      popSSRRenderContext();
    }
  });

  it('starts at `no-preference` when no query matches', () => {
    expect(prefersContrastSignal()()).toBe('no-preference');
  });

  it('returns `more` when (prefers-contrast: more) matches', () => {
    const s = prefersContrastSignal();
    mockMqls.get('(prefers-contrast: more)')!.setMatches(true);
    expect(s()).toBe('more');
  });

  it('returns `less` when (prefers-contrast: less) matches', () => {
    const s = prefersContrastSignal();
    mockMqls.get('(prefers-contrast: less)')!.setMatches(true);
    expect(s()).toBe('less');
  });

  it('returns `custom` when (prefers-contrast: custom) matches', () => {
    const s = prefersContrastSignal();
    mockMqls.get('(prefers-contrast: custom)')!.setMatches(true);
    expect(s()).toBe('custom');
  });

  it('prioritises `more` > `less` > `custom`', () => {
    const s = prefersContrastSignal();
    mockMqls.get('(prefers-contrast: less)')!.setMatches(true);
    mockMqls.get('(prefers-contrast: custom)')!.setMatches(true);
    expect(s()).toBe('less');
    mockMqls.get('(prefers-contrast: more)')!.setMatches(true);
    expect(s()).toBe('more');
  });
});
