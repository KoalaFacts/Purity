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

  it('prefers screen.orientation `change` event when the API is available', () => {
    const listeners: Array<(e: Event) => void> = [];
    const fakeOrientation = {
      type: 'portrait-primary' as string,
      addEventListener: (_t: 'change', cb: (e: Event) => void) => {
        listeners.push(cb);
      },
      removeEventListener: (_t: 'change', cb: (e: Event) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
    Object.defineProperty(globalThis, 'screen', {
      configurable: true,
      value: { orientation: fakeOrientation },
    });
    try {
      const s = screenOrientationSignal();
      expect(s()).toBe('portrait');
      fakeOrientation.type = 'landscape-primary';
      // Fire the registered listener directly.
      expect(listeners.length).toBe(1);
      listeners[0](new Event('change'));
      expect(s()).toBe('landscape');
    } finally {
      _resetScreenOrientationSignal();
      // Listener must be removed by reset.
      expect(listeners.length).toBe(0);
      // Cleanly tear down our screen mock; jsdom re-installs its own next test.
      Object.defineProperty(globalThis, 'screen', {
        configurable: true,
        value: undefined,
      });
    }
  });

  it('falls back to legacy `orientationchange` window event when screen.orientation is absent', () => {
    Object.defineProperty(globalThis, 'screen', {
      configurable: true,
      value: { orientation: undefined },
    });
    // Simulate legacy iOS Safari: `onorientationchange` exists on window.
    const win = window as unknown as { onorientationchange: unknown };
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'onorientationchange');
    Object.defineProperty(window, 'onorientationchange', {
      configurable: true,
      writable: true,
      value: null,
    });
    try {
      setViewport(400, 800);
      const s = screenOrientationSignal();
      expect(s()).toBe('portrait');
      setViewport(800, 400);
      window.dispatchEvent(new Event('orientationchange'));
      expect(s()).toBe('landscape');
    } finally {
      _resetScreenOrientationSignal();
      if (originalDescriptor) {
        Object.defineProperty(window, 'onorientationchange', originalDescriptor);
      } else {
        delete (win as { onorientationchange?: unknown }).onorientationchange;
      }
      Object.defineProperty(globalThis, 'screen', {
        configurable: true,
        value: undefined,
      });
    }
  });

  it('survives a throwing screen.orientation.type getter and falls back to viewport dimensions', () => {
    const fakeOrientation = {
      get type(): string {
        throw new Error('boom');
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    Object.defineProperty(globalThis, 'screen', {
      configurable: true,
      value: { orientation: fakeOrientation },
    });
    try {
      setViewport(800, 400);
      // Should NOT throw — the getter blast is caught and we fall through
      // to the innerWidth/innerHeight derivation.
      expect(screenOrientationSignal()()).toBe('landscape');
    } finally {
      _resetScreenOrientationSignal();
      Object.defineProperty(globalThis, 'screen', {
        configurable: true,
        value: undefined,
      });
    }
  });

  it('survives addEventListener throwing on screen.orientation and falls back to resize', () => {
    const fakeOrientation = {
      type: 'portrait-primary' as string,
      addEventListener: () => {
        throw new Error('add boom');
      },
      removeEventListener: () => {},
    };
    Object.defineProperty(globalThis, 'screen', {
      configurable: true,
      value: { orientation: fakeOrientation },
    });
    try {
      setViewport(400, 800);
      const s = screenOrientationSignal();
      expect(s()).toBe('portrait');
      // Resize fallback should now drive the signal even though the
      // modern API's addEventListener threw.
      setViewport(800, 400);
      window.dispatchEvent(new Event('resize'));
      expect(s()).toBe('landscape');
    } finally {
      _resetScreenOrientationSignal();
      Object.defineProperty(globalThis, 'screen', {
        configurable: true,
        value: undefined,
      });
    }
  });

  it('reset removes the active listener (no leak between sessions)', () => {
    setViewport(400, 800);
    const s1 = screenOrientationSignal();
    expect(s1()).toBe('portrait');
    _resetScreenOrientationSignal();
    // After reset a brand-new singleton is handed out.
    const s2 = screenOrientationSignal();
    expect(s2).not.toBe(s1);
    // Old listener is gone — dispatching resize must not crash and
    // must not throw via a dangling refresh referencing a stale state.
    setViewport(800, 400);
    window.dispatchEvent(new Event('resize'));
    expect(s2()).toBe('landscape');
  });
});
