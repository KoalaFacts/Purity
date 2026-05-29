// @vitest-environment jsdom
// ADR 0041 — screenOrientationSignal tests.
// jsdom doesn't ship screen.orientation; we fall back to innerWidth/Height.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { screenOrientationSignal } from '../src/index.ts';
import { _resetScreenOrientationSignal } from '../src/screen-orientation-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

function setViewport(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

beforeEach(() => {
  _resetScreenOrientationSignal();
  setViewport(400, 800); // portrait by default
});

afterEach(() => {
  _resetScreenOrientationSignal();
});

describe('screenOrientationSignal (ADR 0041)', () => {
  it('returns a constant `portrait` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(screenOrientationSignal()()).toBe('portrait');
    } finally {
      popSSRRenderContext();
    }
  });

  it('derives `portrait` when innerHeight >= innerWidth', () => {
    setViewport(400, 800);
    expect(screenOrientationSignal()()).toBe('portrait');
  });

  it('derives `landscape` when innerWidth > innerHeight', () => {
    setViewport(800, 400);
    expect(screenOrientationSignal()()).toBe('landscape');
  });

  it('updates on resize (innerWidth/innerHeight fallback path)', () => {
    setViewport(400, 800);
    const s = screenOrientationSignal();
    expect(s()).toBe('portrait');
    setViewport(800, 400);
    window.dispatchEvent(new Event('resize'));
    expect(s()).toBe('landscape');
  });

  it('returns the same singleton across calls', () => {
    expect(screenOrientationSignal()).toBe(screenOrientationSignal());
  });
});
