// Shared async helpers for resource() tests and benchmarks.

import type { SSRRenderContext } from '../src/ssr-context.ts';
import { ensureSSRComponentRendererInstalled } from '../../ssr/src/component.ts';

export const tick = (): Promise<void> => new Promise((r) => queueMicrotask(() => r()));

/** Drain several microtask rounds — enough for chained .then handlers + flush. */
export const flushAll = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await tick();
};

/**
 * Build a fresh SSRRenderContext for tests that push/pop the SSR scope.
 * Centralised here so adding new fields to SSRRenderContext doesn't require
 * touching ~30 test files individually.
 */
export function makeSSRContext(): SSRRenderContext {
  ensureSSRComponentRendererInstalled();
  return {
    pendingPromises: [],
    resolvedData: [],
    resolvedErrors: [],
    resourceCounter: 0,
    resolvedDataByKey: Object.create(null),
    resolvedErrorsByKey: Object.create(null),
    suspenseCounter: 0,
    islandCounter: 0,
    boundaryStartTimes: new Map(),
    boundaryDeadlines: new Map(),
    timedOutBoundaries: new Set(),
  };
}

// ---------------------------------------------------------------------------
// matchMedia mock — used by media + environment-preference signal tests.
// ---------------------------------------------------------------------------

export type MockMQL = {
  media: string;
  matches: boolean;
  listeners: ((e: MediaQueryListEvent) => void)[];
  addEventListener(t: 'change', cb: (e: MediaQueryListEvent) => void): void;
  removeEventListener(t: 'change', cb: (e: MediaQueryListEvent) => void): void;
  setMatches(m: boolean): void;
};

export const mockMqls: Map<string, MockMQL> = new Map();
let originalMatchMedia: typeof window.matchMedia | undefined;

export function installMatchMediaMock(): void {
  originalMatchMedia = window.matchMedia;
  (window as unknown as { matchMedia: (q: string) => MockMQL }).matchMedia = (q: string) => {
    let m = mockMqls.get(q);
    if (m) return m;
    m = {
      media: q,
      matches: false,
      listeners: [],
      addEventListener(_t, cb) {
        this.listeners.push(cb);
      },
      removeEventListener(_t, cb) {
        this.listeners = this.listeners.filter((x) => x !== cb);
      },
      setMatches(v) {
        this.matches = v;
        for (const l of this.listeners) l({ matches: v, media: this.media } as MediaQueryListEvent);
      },
    };
    mockMqls.set(q, m);
    return m;
  };
}

export function uninstallMatchMediaMock(): void {
  if (originalMatchMedia === undefined) {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  } else {
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMatchMedia;
  }
  mockMqls.clear();
}

// ---------------------------------------------------------------------------
// Wall-clock threshold helper — used by the coarse O(n) timing tests.
// ---------------------------------------------------------------------------

/**
 * Run `fn` `runs` times and return the fastest wall-clock duration in ms.
 * The minimum filters scheduler noise from parallel test workers (a slow
 * sample is the machine, not the code) without loosening any threshold:
 * an implementation that is really too slow is slow in every run.
 */
export function bestOfMs(fn: () => void, runs = 3): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    if (elapsed < best) best = elapsed;
  }
  return best;
}
