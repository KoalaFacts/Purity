// @vitest-environment jsdom
// ADR 0040 — intersectionSignal tests.
//
// jsdom doesn't ship IntersectionObserver; we install a minimal mock that
// records observed targets and exposes a `fire()` helper to drive
// callbacks synchronously.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { intersectionSignal, mount, watch } from '../src/index.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

type Instance = {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Element[];
  fire(target: Element, isIntersecting: boolean): void;
};

let instances: Instance[] = [];
let OriginalIO: typeof IntersectionObserver | undefined;

class MockIO {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Element[] = [];
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    instances.push({
      callback: this.callback,
      options: this.options,
      targets: this.targets,
      fire: (target, isIntersecting) => {
        this.callback(
          [{ target, isIntersecting } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
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
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
}

beforeEach(() => {
  instances = [];
  OriginalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = MockIO;
});

afterEach(() => {
  if (OriginalIO === undefined) {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  } else {
    (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = OriginalIO;
  }
});

describe('intersectionSignal — SSR (ADR 0040)', () => {
  it('returns a constant `false` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const el = document.createElement('div');
      const sig = intersectionSignal(el);
      expect(sig()).toBe(false);
      expect(instances).toEqual([]);
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns `false` when IntersectionObserver is unavailable', () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const el = document.createElement('div');
    const sig = intersectionSignal(el);
    expect(sig()).toBe(false);
  });
});

describe('intersectionSignal — client (ADR 0040)', () => {
  it('starts as `false` and updates on observer callback', () => {
    const el = document.createElement('div');
    const sig = intersectionSignal(el);
    expect(sig()).toBe(false);
    instances[0].fire(el, true);
    expect(sig()).toBe(true);
    instances[0].fire(el, false);
    expect(sig()).toBe(false);
  });

  it('observes the supplied target with the supplied options', () => {
    const el = document.createElement('div');
    intersectionSignal(el, { rootMargin: '50px', threshold: 0.5 });
    expect(instances).toHaveLength(1);
    expect(instances[0].targets).toContain(el);
    expect(instances[0].options).toEqual({ rootMargin: '50px', threshold: 0.5 });
  });

  it('participates in reactive tracking', async () => {
    const el = document.createElement('div');
    const sig = intersectionSignal(el);
    const seen: boolean[] = [];
    const dispose = watch(() => seen.push(sig()));
    instances[0].fire(el, true);
    await tick();
    instances[0].fire(el, false);
    await tick();
    expect(seen).toEqual([false, true, false]);
    dispose();
  });

  it('uses the last entry of a batch when the callback fires multiple', () => {
    const el = document.createElement('div');
    const sig = intersectionSignal(el);
    instances[0].callback(
      [
        { target: el, isIntersecting: false } as IntersectionObserverEntry,
        { target: el, isIntersecting: true } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
    expect(sig()).toBe(true);
  });

  it('auto-disconnects the observer when the surrounding component unmounts', () => {
    // intersectionSignal() called inside a component must register a
    // disposer that disconnects the underlying IntersectionObserver on
    // unmount. Without it the observer outlived the component and pinned
    // the captured signal-graph closure until the accessor was GC'd.
    let disconnects = 0;
    const OrigMockIO = (globalThis as { IntersectionObserver: typeof MockIO }).IntersectionObserver;
    class CountingIO extends OrigMockIO {
      disconnect(): void {
        disconnects++;
        super.disconnect();
      }
    }
    (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = CountingIO;
    try {
      const target = document.createElement('div');
      const host = document.createElement('div');
      const { unmount } = mount(() => {
        intersectionSignal(target);
        return document.createComment('m');
      }, host);
      expect(disconnects).toBe(0);
      unmount();
      expect(disconnects).toBe(1);
    } finally {
      (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = OrigMockIO;
    }
  });
});
