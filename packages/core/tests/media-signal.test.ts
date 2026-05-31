// @vitest-environment jsdom
// ADR 0040 — mediaSignal tests.
// jsdom doesn't ship matchMedia; we install a controllable mock.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mediaSignal, watch } from '../src/index.ts';
import { _resetMediaSignalCache } from '../src/media-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

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

  it('_resetMediaSignalCache detaches the change listener (no leak across resets)', () => {
    mediaSignal('(min-width: 600px)');
    const mql = mqlsByQuery.get('(min-width: 600px)')!;
    expect(mql.listeners.length).toBe(1);

    // Browsers cache `matchMedia(q)` so the same `mql` is reused on the
    // next call — without proper cleanup the second call stacks a second
    // listener on the same target. Reset must detach.
    _resetMediaSignalCache();
    expect(mql.listeners.length).toBe(0);

    mediaSignal('(min-width: 600px)');
    expect(mql.listeners.length).toBe(1);
  });
});

describe('mediaSignal — audit-v2 hardening', () => {
  it('returns false for empty / non-string query without calling matchMedia', () => {
    const sig = mediaSignal('');
    expect(sig()).toBe(false);
    expect(mqlsByQuery.size).toBe(0);
    // Non-string input — TS-checked at compile time, but runtime must not
    // crash if a JS caller passes garbage.
    const sig2 = mediaSignal(null as unknown as string);
    expect(sig2()).toBe(false);
    const sig3 = mediaSignal(undefined as unknown as string);
    expect(sig3()).toBe(false);
    expect(mqlsByQuery.size).toBe(0);
  });

  it('handles invalid CSS queries (matchMedia throws) without crashing', () => {
    // Force matchMedia to throw SyntaxError, mirroring WebKit's behaviour.
    (window as unknown as { matchMedia: (q: string) => never }).matchMedia = () => {
      throw new SyntaxError('invalid media query');
    };
    const sig = mediaSignal('@@@ bogus @@@');
    expect(sig()).toBe(false);
    // Same query → same cached fallback (no repeated throws).
    const sig2 = mediaSignal('@@@ bogus @@@');
    expect(sig).toBe(sig2);
  });

  it('uses legacy addListener/removeListener when addEventListener is missing', async () => {
    // Override the mock to emit a legacy MQL (Safari < 14 / Edge Legacy
    // shape). The signal must bind via addListener and detach via
    // removeListener at reset time.
    type LegacyMQL = {
      media: string;
      matches: boolean;
      legacyListeners: ((e: MediaQueryListEvent) => void)[];
      addListener(cb: (e: MediaQueryListEvent) => void): void;
      removeListener(cb: (e: MediaQueryListEvent) => void): void;
      setMatches(m: boolean): void;
    };
    let legacy: LegacyMQL | undefined;
    (window as unknown as { matchMedia: (q: string) => LegacyMQL }).matchMedia = (q: string) => {
      legacy ??= {
        media: q,
        matches: false,
        legacyListeners: [],
        addListener(cb) {
          this.legacyListeners.push(cb);
        },
        removeListener(cb) {
          this.legacyListeners = this.legacyListeners.filter((x) => x !== cb);
        },
        setMatches(m) {
          this.matches = m;
          for (const l of this.legacyListeners) {
            l({ matches: m, media: this.media } as MediaQueryListEvent);
          }
        },
      };
      return legacy;
    };

    const sig = mediaSignal('(min-width: 800px)');
    expect(sig()).toBe(false);
    expect(legacy!.legacyListeners.length).toBe(1);

    // Updates must propagate through the legacy listener.
    const seen: boolean[] = [];
    const dispose = watch(() => seen.push(sig()));
    legacy!.setMatches(true);
    await tick();
    expect(seen).toEqual([false, true]);
    dispose();

    // Reset must detach the legacy listener (otherwise repeated reset+
    // rebind stacks N listeners on the same target — the leak this audit
    // is preventing).
    _resetMediaSignalCache();
    expect(legacy!.legacyListeners.length).toBe(0);
  });

  it('isolates a throwing addEventListener — accessor still returns initial matches', () => {
    // Hostile MQL: addEventListener blows up. The mediaSignal must
    // (a) not crash, (b) return a working accessor seeded at mql.matches,
    // and (c) not poison the per-query cache.
    (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia = (q: string) => ({
      media: q,
      matches: true,
      addEventListener() {
        throw new Error('boom');
      },
      removeEventListener() {},
    });
    const sig = mediaSignal('(min-width: 999px)');
    expect(sig()).toBe(true);
    // Cached — same query → same accessor.
    const sig2 = mediaSignal('(min-width: 999px)');
    expect(sig).toBe(sig2);
  });
});
