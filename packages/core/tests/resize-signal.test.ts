// @vitest-environment jsdom
// ADR 0040 — resizeSignal tests.
// jsdom doesn't ship ResizeObserver; we install a controllable mock.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resizeSignal, watch } from '../src/index.ts';
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
});
