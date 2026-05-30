// @vitest-environment jsdom
// ADR 0040 — resizeSignal tests.
// jsdom doesn't ship ResizeObserver; we install a controllable mock.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mount, resizeSignal, watch } from '../src/index.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

type Instance = {
  callback: ResizeObserverCallback;
  targets: Element[];
  fire(target: Element, rect: Partial<DOMRectReadOnly>): void;
};

let instances: Instance[] = [];
let OriginalRO: typeof ResizeObserver | undefined;

class MockRO {
  callback: ResizeObserverCallback;
  targets: Element[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    instances.push({
      callback: this.callback,
      targets: this.targets,
      fire: (target, rect) => {
        const full: DOMRectReadOnly = {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          toJSON() {
            return this;
          },
          ...rect,
        } as DOMRectReadOnly;
        this.callback(
          [{ target, contentRect: full } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      },
    });
  }
  observe(t: Element): void {
    this.targets.push(t);
  }
  unobserve(t: Element): void {
    this.targets = this.targets.filter((x) => x !== t);
  }
  disconnect(): void {
    this.targets = [];
  }
}

beforeEach(() => {
  instances = [];
  OriginalRO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = MockRO;
});

afterEach(() => {
  if (OriginalRO === undefined) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  } else {
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = OriginalRO;
  }
});

describe('resizeSignal — SSR (ADR 0040)', () => {
  it('returns a zero rect in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const el = document.createElement('div');
      const sig = resizeSignal(el);
      const r = sig();
      expect(r.width).toBe(0);
      expect(r.height).toBe(0);
      expect(instances).toEqual([]);
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns a zero rect when ResizeObserver is unavailable', () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    const el = document.createElement('div');
    const sig = resizeSignal(el);
    expect(sig().width).toBe(0);
  });
});

describe('resizeSignal — client (ADR 0040)', () => {
  it('seeds the initial value from getBoundingClientRect', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        width: 100,
        height: 50,
        x: 0,
        y: 0,
        top: 0,
        right: 100,
        bottom: 50,
        left: 0,
      }),
    });
    const sig = resizeSignal(el);
    expect(sig().width).toBe(100);
    expect(sig().height).toBe(50);
  });

  it('observes the supplied target', () => {
    const el = document.createElement('div');
    resizeSignal(el, { box: 'border-box' });
    expect(instances).toHaveLength(1);
    expect(instances[0].targets).toContain(el);
  });

  it('updates on observer callback', () => {
    const el = document.createElement('div');
    const sig = resizeSignal(el);
    instances[0].fire(el, { width: 200, height: 75 });
    expect(sig().width).toBe(200);
    expect(sig().height).toBe(75);
  });

  it('composes with compute() for breakpoint-style derived signals', async () => {
    const el = document.createElement('div');
    const rect = resizeSignal(el);
    let wideValue = false;
    const dispose = watch(() => {
      wideValue = rect().width > 600;
    });
    instances[0].fire(el, { width: 400 });
    await tick();
    expect(wideValue).toBe(false);
    instances[0].fire(el, { width: 800 });
    await tick();
    expect(wideValue).toBe(true);
    dispose();
  });

  it('auto-disconnects the observer when the surrounding component unmounts', () => {
    // resizeSignal() called inside a component must register a disposer that
    // disconnects the underlying ResizeObserver on unmount; without it the
    // observer outlives the component and pins captured closures until the
    // accessor is GC'd.
    let disconnects = 0;
    const OrigMockRO = (globalThis as { ResizeObserver: typeof MockRO }).ResizeObserver;
    class CountingRO extends OrigMockRO {
      disconnect(): void {
        disconnects++;
        super.disconnect();
      }
    }
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = CountingRO;
    try {
      const target = document.createElement('div');
      const host = document.createElement('div');
      const { unmount } = mount(() => {
        resizeSignal(target);
        return document.createComment('m');
      }, host);
      expect(disconnects).toBe(0);
      unmount();
      expect(disconnects).toBe(1);
    } finally {
      (globalThis as { ResizeObserver: unknown }).ResizeObserver = OrigMockRO;
    }
  });

  it('isolates callback throws so the observer keeps observing', async () => {
    // If a downstream watcher throws, the observer callback must not
    // propagate — otherwise the browser engine logs an unhandled error and
    // subsequent entries can be lost. Errors are surfaced via console.error.
    const el = document.createElement('div');
    const sig = resizeSignal(el);
    const seen: number[] = [];
    let throwOnce = true;
    const dispose = watch(() => {
      const w = sig().width;
      seen.push(w);
      if (throwOnce && w === 200) {
        throwOnce = false;
        throw new Error('downstream boom');
      }
    });
    const origErr = console.error;
    const errs: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errs.push(args);
    };
    try {
      expect(() => instances[0].fire(el, { width: 200, height: 10 })).not.toThrow();
      await tick();
      expect(() => instances[0].fire(el, { width: 300, height: 10 })).not.toThrow();
      await tick();
    } finally {
      console.error = origErr;
      dispose();
    }
    expect(sig().width).toBe(300);
    expect(errs.length).toBeGreaterThan(0);
  });

  it('falls back to a zero rect when getBoundingClientRect throws', () => {
    // A detached or exotic Element can throw from getBoundingClientRect();
    // the signal must seed the zero rect rather than crash on construction.
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => {
        throw new Error('detached');
      },
    });
    const origErr = console.error;
    console.error = () => {};
    try {
      const sig = resizeSignal(el);
      expect(sig().width).toBe(0);
      expect(sig().height).toBe(0);
    } finally {
      console.error = origErr;
    }
  });

  it('ignores observer batches that lack a usable entry', () => {
    // A malformed batch (empty array, or entries with no contentRect) must
    // not crash the callback. The previous value is preserved.
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        width: 42,
        height: 7,
        x: 0,
        y: 0,
        top: 0,
        right: 42,
        bottom: 7,
        left: 0,
      }),
    });
    const sig = resizeSignal(el);
    expect(() =>
      instances[0].callback([], { } as ResizeObserver),
    ).not.toThrow();
    expect(() =>
      instances[0].callback(
        [{ target: el } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    ).not.toThrow();
    expect(sig().width).toBe(42);
    expect(sig().height).toBe(7);
  });

  it('freezes the initial rect so callers cannot mutate it', () => {
    // The first read must return an immutable snapshot — ZERO_RECT is frozen
    // for the SSR/no-API path, and getBoundingClientRect()'s live DOMRect
    // must be normalised into the same shape so consumers cannot mutate it
    // out from under the signal graph.
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        width: 13,
        height: 9,
        x: 1,
        y: 2,
        top: 2,
        right: 14,
        bottom: 11,
        left: 1,
      }),
    });
    const sig = resizeSignal(el);
    const initial = sig() as DOMRectReadOnly & { width: number };
    expect(Object.isFrozen(initial)).toBe(true);
    expect(() => {
      (initial as { width: number }).width = 999;
    }).toThrow();
    expect(sig().width).toBe(13);
  });
});
