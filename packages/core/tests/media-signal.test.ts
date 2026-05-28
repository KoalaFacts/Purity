// @vitest-environment jsdom
// ADR 0040 — mediaSignal tests.
// jsdom doesn't ship matchMedia; we install a controllable mock.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mediaSignal, watch } from '../src/index.ts';
import { _resetMediaSignalCache } from '../src/media-signal.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

function makeSSRContext(): SSRRenderContext {
  return {
    pendingPromises: [],
    resolvedData: [],
    resolvedErrors: [],
    resourceCounter: 0,
    resolvedDataByKey: {},
    resolvedErrorsByKey: {},
    suspenseCounter: 0,
    boundaryStartTimes: new Map(),
  };
}

type MockMQL = {
  media: string;
  matches: boolean;
  listeners: ((e: MediaQueryListEvent) => void)[];
  addEventListener(type: 'change', cb: (e: MediaQueryListEvent) => void): void;
  removeEventListener(type: 'change', cb: (e: MediaQueryListEvent) => void): void;
  setMatches(matches: boolean): void;
};

const mqlsByQuery: Map<string, MockMQL> = new Map();
let originalMatchMedia: typeof window.matchMedia | undefined;

function installMatchMediaMock(): void {
  originalMatchMedia = window.matchMedia;
  (window as unknown as { matchMedia: (q: string) => MockMQL }).matchMedia = (query: string) => {
    let mql = mqlsByQuery.get(query);
    if (mql) return mql;
    mql = {
      media: query,
      matches: false,
      listeners: [],
      addEventListener(type, cb) {
        if (type === 'change') this.listeners.push(cb);
      },
      removeEventListener(type, cb) {
        if (type === 'change') this.listeners = this.listeners.filter((x) => x !== cb);
      },
      setMatches(matches) {
        this.matches = matches;
        for (const l of this.listeners) {
          l({ matches, media: this.media } as MediaQueryListEvent);
        }
      },
    };
    mqlsByQuery.set(query, mql);
    return mql;
  };
}

function uninstallMatchMediaMock(): void {
  if (originalMatchMedia === undefined) {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  } else {
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMatchMedia;
  }
  mqlsByQuery.clear();
}

beforeEach(() => {
  _resetMediaSignalCache();
  installMatchMediaMock();
});

afterEach(() => {
  uninstallMatchMediaMock();
  _resetMediaSignalCache();
});

describe('mediaSignal — SSR (ADR 0040)', () => {
  it('returns a constant `false` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const sig = mediaSignal('(prefers-color-scheme: dark)');
      expect(sig()).toBe(false);
      expect(mqlsByQuery.size).toBe(0);
    } finally {
      popSSRRenderContext();
    }
  });

  it('returns `false` when matchMedia is unavailable', () => {
    uninstallMatchMediaMock();
    const sig = mediaSignal('(min-width: 600px)');
    expect(sig()).toBe(false);
    installMatchMediaMock();
  });
});

describe('mediaSignal — client (ADR 0040)', () => {
  it('reflects the initial mql.matches value', () => {
    const sig = mediaSignal('(min-width: 600px)');
    expect(sig()).toBe(false);
    // Reset cache + initial state to test the truthy path.
    _resetMediaSignalCache();
    mqlsByQuery.clear();
    installMatchMediaMock();
    const q = '(min-width: 400px)';
    // Pre-create with matches=true.
    const mql = window.matchMedia(q) as unknown as MockMQL;
    mql.matches = true;
    const sig2 = mediaSignal(q);
    expect(sig2()).toBe(true);
  });

  it('updates on change event', async () => {
    const sig = mediaSignal('(min-width: 600px)');
    const seen: boolean[] = [];
    const dispose = watch(() => seen.push(sig()));
    const mql = mqlsByQuery.get('(min-width: 600px)')!;
    mql.setMatches(true);
    await tick();
    mql.setMatches(false);
    await tick();
    expect(seen).toEqual([false, true, false]);
    dispose();
  });

  it('caches per query string', () => {
    const a = mediaSignal('(min-width: 600px)');
    const b = mediaSignal('(min-width: 600px)');
    expect(a).toBe(b);
    expect(mqlsByQuery.size).toBe(1);
  });

  it('different queries get different signals', () => {
    const a = mediaSignal('(min-width: 600px)');
    const b = mediaSignal('(prefers-color-scheme: dark)');
    expect(a).not.toBe(b);
    expect(mqlsByQuery.size).toBe(2);
  });
});
