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

  it('detaches the listener from the prior MQL when rebinding (no leak)', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;
    expect(oneDppx.listeners.length).toBe(1);

    setDpr(2);
    oneDppx.setMatches(false);
    expect(s()).toBe(2);
    // Previous MQL must have no listener attached anymore.
    expect(oneDppx.listeners.length).toBe(0);
    // New MQL has exactly one listener.
    const twoDppx = mockMqls.get('(resolution: 2dppx)')!;
    expect(twoDppx.listeners.length).toBe(1);
  });

  it('does not stack listeners when the runtime returns the same MQL for the same query', () => {
    // The mock dedupes by query string — same MQL identity across calls.
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);

    // Oscillate 1 → 2 → 1 → 2; same MQL instance is reused per query.
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;
    setDpr(2);
    oneDppx.setMatches(false);
    const twoDppx = mockMqls.get('(resolution: 2dppx)')!;

    setDpr(1);
    twoDppx.setMatches(false);
    setDpr(2);
    oneDppx.setMatches(false);

    expect(s()).toBe(2);
    // After the cycle, only the active (2dppx) MQL holds a single listener;
    // the inactive one is fully detached.
    expect(twoDppx.listeners.length).toBe(1);
    expect(oneDppx.listeners.length).toBe(0);
  });

  it('ignores spurious change events when DPR has not actually changed', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    // Fire change without mutating window.devicePixelRatio. Must NOT rebind to
    // a new MQL or stack a listener on the cached 1dppx instance.
    oneDppx.setMatches(false);
    expect(s()).toBe(1);
    expect(oneDppx.listeners.length).toBe(1);
    // No phantom MQL created for the no-op rebind.
    expect(mockMqls.size).toBe(1);
  });

  it('survives matchMedia throwing during rebind (keeps previous binding live)', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    // Make the next matchMedia call throw — the rebind path must bail
    // cleanly without leaving us listener-less or state-desynced.
    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = () => {
      throw new Error('hostile engine');
    };
    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();
    // State must NOT have advanced if the new MQL couldn't be created —
    // otherwise the signal value diverges from the actively-bound query.
    expect(s()).toBe(1);
    // Old listener must still be attached so we observe future changes.
    expect(oneDppx.listeners.length).toBe(1);

    // Restore + verify a subsequent successful rebind still works.
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;
    oneDppx.setMatches(false);
    expect(s()).toBe(2);
  });

  it('does not infinite-loop when the change handler re-enters synchronously', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    // Wrap the 2dppx attach so attaching a listener synchronously fires a
    // nested change event — the re-entrance guard must drop it.
    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      q: string,
    ) => {
      const m = originalMm(q);
      if (q === '(resolution: 2dppx)') {
        const origAdd = m.addEventListener.bind(m);
        let firstAttach = true;
        (m as unknown as { addEventListener: typeof m.addEventListener }).addEventListener = ((
          t: 'change',
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          origAdd(t, cb);
          if (firstAttach) {
            firstAttach = false;
            // Simulate a hostile engine firing change synchronously inside attach.
            cb({ matches: false, media: q } as MediaQueryListEvent);
          }
        }) as typeof m.addEventListener;
      }
      return m;
    };

    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;
    expect(s()).toBe(2);
  });

  it('falls back to a constant when matchMedia is missing entirely', () => {
    _resetDevicePixelRatioSignal();
    uninstallMatchMediaMock();
    setDpr(3);
    expect(devicePixelRatioSignal()()).toBe(1);
    // Re-install mock for afterEach cleanup symmetry.
    installMatchMediaMock();
  });
});
