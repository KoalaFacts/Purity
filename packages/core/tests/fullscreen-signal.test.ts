// @vitest-environment jsdom
// ADR 0041 — fullscreenSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fullscreenSignal } from '../src/index.ts';
import { _resetFullscreenSignal } from '../src/fullscreen-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

function setFullscreenElement(el: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
}

beforeEach(() => {
  _resetFullscreenSignal();
  setFullscreenElement(null);
});

afterEach(() => {
  _resetFullscreenSignal();
  setFullscreenElement(null);
});

describe('fullscreenSignal (ADR 0041)', () => {
  it('returns a constant `null` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(fullscreenSignal()()).toBeNull();
    } finally {
      popSSRRenderContext();
    }
  });

  it('reflects document.fullscreenElement on first read', () => {
    const el = document.createElement('div');
    setFullscreenElement(el);
    expect(fullscreenSignal()()).toBe(el);
  });

  it('updates on fullscreenchange event', () => {
    const s = fullscreenSignal();
    expect(s()).toBeNull();
    const el = document.createElement('div');
    setFullscreenElement(el);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(s()).toBe(el);
    setFullscreenElement(null);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(s()).toBeNull();
  });

  it('returns the same singleton across calls', () => {
    expect(fullscreenSignal()).toBe(fullscreenSignal());
  });
});
