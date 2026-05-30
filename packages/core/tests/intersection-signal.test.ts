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

  it('returns constant `false` (no observer) when target is null/undefined', () => {
    // Regression: prior implementation called `observer.observe(null)`,
    // which throws TypeError in spec — the freshly-built observer leaked
    // and the call appeared to "succeed" with the throw bubbling out of
    // the framework. Now we short-circuit before constructing the IO.
    const sig = intersectionSignal(null as unknown as Element);
    expect(sig()).toBe(false);
    expect(instances).toEqual([]);
    const sig2 = intersectionSignal(undefined as unknown as Element);
    expect(sig2()).toBe(false);
    expect(instances).toEqual([]);
  });

  it('isolates throws inside the observer callback', () => {
    // Regression: if `entry.isIntersecting` (a getter on real engines)
    // throws, or anything synchronous on the write path throws, the
    // exception used to propagate back through the IntersectionObserver
    // dispatch — producing an Uncaught with no source frame and, on
    // some engines, killing the IO microtask so further notifications
    // for unrelated observers in the same batch were dropped. We now
    // catch + console.error, matching the disposer convention in
    // component.ts (`console.error('[Purity] Error during disposal:'`).
    const el = document.createElement('div');
    const sig = intersectionSignal(el);
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      // Simulate the real-engine getter throwing: deliver an entry
      // whose `isIntersecting` access throws synchronously.
      const throwingEntry = {
        target: el,
        get isIntersecting(): boolean {
          throw new Error('boom');
        },
      } as unknown as IntersectionObserverEntry;
      expect(() =>
        instances[0].callback([throwingEntry], {} as IntersectionObserver),
      ).not.toThrow();
      expect(errors.length).toBeGreaterThan(0);
      expect(String(errors[0]?.[0])).toContain('intersectionSignal callback error');
      // Pipeline still healthy after the bad entry — a follow-up fire
      // must still push the new value through the signal.
      instances[0].fire(el, true);
      expect(sig()).toBe(true);
    } finally {
      console.error = origError;
    }
  });

  it('disconnects the observer and rethrows if observe() throws', () => {
    // Regression: if observe() throws (detached node on some engines,
    // late option validation, etc.) the just-constructed observer was
    // leaked. We now disconnect before rethrowing so the OS-side
    // observer is released.
    const OrigMockIO = (globalThis as { IntersectionObserver: typeof MockIO }).IntersectionObserver;
    let disconnects = 0;
    class ObserveThrowsIO extends OrigMockIO {
      observe(): void {
        throw new Error('cannot observe detached');
      }
      disconnect(): void {
        disconnects++;
        super.disconnect();
      }
    }
    (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = ObserveThrowsIO;
    try {
      const target = document.createElement('div');
      expect(() => intersectionSignal(target)).toThrow('cannot observe detached');
      expect(disconnects).toBe(1);
    } finally {
      (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = OrigMockIO;
    }
  });

  it('disposer is idempotent — disconnect() runs once even if fired twice', () => {
    // Regression: pathological teardown ordering (parent + child both
    // holding the same disposer ref, or a manual re-trigger from app
    // code) used to call observer.disconnect() N times. We guard with
    // a `disposed` flag inside the disposer closure so the contract is
    // explicit, regardless of engine-level idempotency.
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
      // First teardown: runs the disposer normally.
      unmount();
      expect(disconnects).toBe(1);
      // Second teardown: a no-op at the component level (already
      // destroyed), so disconnects must stay at 1. Smoke test for the
      // `disposed` flag — without the flag, an engine that doesn't
      // no-op disconnect would tick to 2.
      unmount();
      expect(disconnects).toBe(1);
    } finally {
      (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = OrigMockIO;
    }
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
