// @vitest-environment jsdom
// ADR 0041 — devicePixelRatioSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { devicePixelRatioSignal } from '../src/index.ts';
import { _resetDevicePixelRatioSignal } from '../src/device-pixel-ratio-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import {
  installMatchMediaMock,
  mockMqls,
  uninstallMatchMediaMock,
  makeSSRContext,
} from './_helpers.ts';

function setDpr(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value });
}

beforeEach(() => {
  _resetDevicePixelRatioSignal();
  installMatchMediaMock();
  setDpr(1);
});

afterEach(() => {
  uninstallMatchMediaMock();
  _resetDevicePixelRatioSignal();
});

describe('devicePixelRatioSignal (ADR 0041)', () => {
  it('returns a constant `1` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(devicePixelRatioSignal()()).toBe(1);
    } finally {
      popSSRRenderContext();
    }
  });

  it('reflects window.devicePixelRatio on first read', () => {
    setDpr(2);
    expect(devicePixelRatioSignal()()).toBe(2);
  });

  it('rebinds to a new media query when DPR changes', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    expect(mockMqls.has('(resolution: 1dppx)')).toBe(true);

    // Simulate DPR change: update navigator, then fire the existing mql's
    // change event (it would stop matching).
    setDpr(2);
    mockMqls.get('(resolution: 1dppx)')!.setMatches(false);
    expect(s()).toBe(2);
    expect(mockMqls.has('(resolution: 2dppx)')).toBe(true);
  });

  it('returns the same singleton across calls', () => {
    expect(devicePixelRatioSignal()).toBe(devicePixelRatioSignal());
  });
});
