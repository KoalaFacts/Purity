// @vitest-environment jsdom
// ADR 0039 — localSignal tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localSignal, watch } from '../src/index.ts';
import { _resetLocalSignalRegistry } from '../src/local-signal.ts';
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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  _resetLocalSignalRegistry();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('localSignal — SSR path (ADR 0039)', () => {
  it('returns a plain state with the default on the server', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const theme = localSignal('theme', 'light');
      expect(theme()).toBe('light');
      theme.set('dark');
      expect(theme()).toBe('dark');
    } finally {
      popSSRRenderContext();
    }
    // No write to localStorage happened during SSR.
    expect(localStorage.getItem('theme')).toBeNull();
  });
});

describe('localSignal — client path (ADR 0039)', () => {
  it('uses the default when storage is empty', () => {
    const theme = localSignal('theme', 'light');
    expect(theme()).toBe('light');
  });

  it('reads the persisted value on first construction', () => {
    localStorage.setItem('theme', JSON.stringify('dark'));
    const theme = localSignal('theme', 'light');
    expect(theme()).toBe('dark');
  });

  it('writes to storage on set + accessor call + updater', () => {
    const theme = localSignal('theme', 'light');
    theme.set('dark');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('dark'));
    theme('blue');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('blue'));
    theme((v) => v + '!');
    expect(localStorage.getItem('theme')).toBe(JSON.stringify('blue!'));
  });

  it('supports sessionStorage via options.storage', () => {
    const cart = localSignal('cart', [] as string[], { storage: 'session' });
    cart.set(['apple']);
    expect(sessionStorage.getItem('cart')).toBe(JSON.stringify(['apple']));
    expect(localStorage.getItem('cart')).toBeNull();
  });

  it('participates in reactive tracking', async () => {
    const theme = localSignal('theme', 'light');
    const seen: string[] = [];
    const dispose = watch(() => {
      seen.push(theme());
    });
    theme.set('dark');
    await tick();
    expect(seen).toEqual(['light', 'dark']);
    dispose();
  });

  it('falls back to default when stored JSON is malformed', () => {
    localStorage.setItem('theme', '<not-json>');
    const theme = localSignal('theme', 'light');
    expect(theme()).toBe('light');
  });

  it('reacts to cross-tab `storage` events', () => {
    const theme = localSignal('theme', 'light');
    expect(theme()).toBe('light');
    // Simulate another tab writing.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: JSON.stringify('dark'),
        oldValue: null,
        storageArea: localStorage,
      }),
    );
    expect(theme()).toBe('dark');
  });

  it('cross-tab apply does NOT echo back to storage', () => {
    localStorage.setItem('theme', JSON.stringify('light'));
    const theme = localSignal('theme', 'light');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: JSON.stringify('dark'),
      }),
    );
    expect(theme()).toBe('dark');
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('resets to default when the storage key is removed externally', () => {
    localStorage.setItem('theme', JSON.stringify('dark'));
    const theme = localSignal('theme', 'light');
    expect(theme()).toBe('dark');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: null,
        oldValue: JSON.stringify('dark'),
      }),
    );
    expect(theme()).toBe('light');
  });

  it('resets every key to default on full storage clear (key === null)', () => {
    const a = localSignal('a', 0);
    const b = localSignal('b', 'x');
    a.set(5);
    b.set('y');
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    expect(a()).toBe(0);
    expect(b()).toBe('x');
  });

  it('logs (but does not throw) when storage.setItem throws', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    const theme = localSignal('theme', 'light');
    expect(() => theme.set('dark')).not.toThrow();
    expect(theme()).toBe('dark'); // in-memory update still wins
    expect(errSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('supports custom serialize/deserialize', () => {
    const dateSig = localSignal('d', new Date(0), {
      serialize: (d) => String(d.getTime()),
      deserialize: (s) => new Date(Number(s)),
    });
    const t = new Date('2026-01-01T00:00:00Z');
    dateSig.set(t);
    expect(localStorage.getItem('d')).toBe(String(t.getTime()));
    _resetLocalSignalRegistry();
    const dateSig2 = localSignal('d', new Date(0), {
      serialize: (d) => String(d.getTime()),
      deserialize: (s) => new Date(Number(s)),
    });
    expect(dateSig2().getTime()).toBe(t.getTime());
  });
});

describe('localSignal — versioning + migration (ADR 0039)', () => {
  it('wraps writes in a version envelope when version > 0', () => {
    const sig = localSignal('v', { n: 1 }, { version: 2 });
    sig.set({ n: 5 });
    const raw = localStorage.getItem('v')!;
    const parsed = JSON.parse(raw);
    expect(parsed.__pv).toBe(2);
    expect(JSON.parse(parsed.d)).toEqual({ n: 5 });
  });

  it('migrates from an older envelope version', () => {
    localStorage.setItem('v', JSON.stringify({ __pv: 1, d: JSON.stringify({ legacy: true }) }));
    const sig = localSignal('v', { upgraded: false } as { upgraded: boolean; from?: number }, {
      version: 2,
      migrate: (old, oldVersion) => ({ upgraded: true, from: oldVersion }),
    });
    expect(sig()).toEqual({ upgraded: true, from: 1 });
    // The upgraded value should have been written back at version 2.
    const raw = JSON.parse(localStorage.getItem('v')!);
    expect(raw.__pv).toBe(2);
    expect(JSON.parse(raw.d)).toEqual({ upgraded: true, from: 1 });
  });

  it('falls back to default when version mismatches and no migrate is provided', () => {
    localStorage.setItem('v', JSON.stringify({ __pv: 1, d: '"old"' }));
    const sig = localSignal('v', 'fresh', { version: 2 });
    expect(sig()).toBe('fresh');
  });

  it('treats a non-envelope legacy value as version 0', () => {
    localStorage.setItem('v', JSON.stringify('legacy-raw'));
    const seen: Array<{ old: unknown; from: number }> = [];
    const sig = localSignal('v', 'default', {
      version: 1,
      migrate: (old, from) => {
        seen.push({ old, from });
        return 'migrated';
      },
    });
    expect(sig()).toBe('migrated');
    expect(seen).toEqual([{ old: 'legacy-raw', from: 0 }]);
  });
});
