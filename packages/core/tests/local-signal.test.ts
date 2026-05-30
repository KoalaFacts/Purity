// @vitest-environment jsdom
// ADR 0039 — localSignal tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localSignal, watch } from '../src/index.ts';
import { _resetLocalSignalRegistry } from '../src/local-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

// Build a `storage`-typed Event with the relevant StorageEventInit fields
// patched on. Constructing `new StorageEvent('storage', init)` is
// spec-compliant but CodeQL's web externs flag the init arg as
// "superfluous" — this helper keeps the call sites quiet without losing
// the signal under test.
function makeStorageEvent(init: {
  key: string | null;
  newValue: string | null;
  oldValue?: string | null;
  storageArea?: Storage;
}): Event {
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: init.key });
  Object.defineProperty(event, 'newValue', { value: init.newValue });
  if ('oldValue' in init) {
    Object.defineProperty(event, 'oldValue', { value: init.oldValue });
  }
  if (init.storageArea) {
    Object.defineProperty(event, 'storageArea', { value: init.storageArea });
  }
  return event;
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
      makeStorageEvent({
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
      makeStorageEvent({
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
      makeStorageEvent({
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
    window.dispatchEvent(makeStorageEvent({ key: null, newValue: null }));
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

  it('logs (but does not throw) when serialize itself throws', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sig = localSignal<{ ref: unknown }>(
      'cyclic',
      { ref: null },
      {
        // Force serialize to throw on every write — simulates circular refs /
        // BigInt / a user-supplied serializer that rejects bad input.
        serialize: () => {
          throw new Error('cannot serialize');
        },
        deserialize: (raw) => JSON.parse(raw),
      },
    );
    expect(() => sig.set({ ref: {} })).not.toThrow();
    expect(sig()).toEqual({ ref: {} });
    expect(errSpy).toHaveBeenCalled();
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

describe('localSignal — registry isolation + lifecycle', () => {
  it('a localStorage event does not bleed into a sessionStorage-backed signal sharing the key', () => {
    // Same key, different storage backends. The previous registry used the
    // bare key — so a localStorage `storage` event also drove the
    // sessionStorage-backed signal, cross-contaminating two unrelated stores.
    const localSig = localSignal('shared', 'L', { storage: 'local' });
    const sessSig = localSignal('shared', 'S', { storage: 'session' });
    expect(localSig()).toBe('L');
    expect(sessSig()).toBe('S');
    window.dispatchEvent(
      makeStorageEvent({
        key: 'shared',
        newValue: JSON.stringify('LL'),
        oldValue: null,
        storageArea: localStorage,
      }),
    );
    expect(localSig()).toBe('LL');
    // Session signal MUST be unaffected by a localStorage event.
    expect(sessSig()).toBe('S');
  });

  it('a localStorage clear (key === null) only resets local-backed signals', () => {
    const localSig = localSignal('a', 'L-default', { storage: 'local' });
    const sessSig = localSignal('a', 'S-default', { storage: 'session' });
    localSig.set('L-set');
    sessSig.set('S-set');
    window.dispatchEvent(
      makeStorageEvent({ key: null, newValue: null, storageArea: localStorage }),
    );
    expect(localSig()).toBe('L-default');
    // Session signal MUST survive a localStorage clear.
    expect(sessSig()).toBe('S-set');
  });

  it('auto-cleans the registry when the surrounding component unmounts', async () => {
    // Without lifecycle cleanup, every component mount that calls
    // localSignal() leaks one Registration + one captured state node into
    // the registry forever. Verify the cleanup is wired through to the
    // current component context (matches how watch() auto-disposes).
    const { mount } = await import('../src/index.ts');
    const { _localSignalRegistrySize } = await import('../src/local-signal.ts');
    const container = document.createElement('div');
    expect(_localSignalRegistrySize('local', 'per-mount')).toBe(0);
    const m1 = mount(() => {
      localSignal('per-mount', 'x');
      return document.createComment('m');
    }, container);
    expect(_localSignalRegistrySize('local', 'per-mount')).toBe(1);
    const m2 = mount(() => {
      localSignal('per-mount', 'y');
      return document.createComment('m');
    }, container);
    expect(_localSignalRegistrySize('local', 'per-mount')).toBe(2);
    m1.unmount();
    expect(_localSignalRegistrySize('local', 'per-mount')).toBe(1);
    m2.unmount();
    // Both registrations gone; the empty Set is also dropped so a future
    // lookup doesn't grow the Map without bound.
    expect(_localSignalRegistrySize('local', 'per-mount')).toBe(0);
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

  it('a throwing migrate does NOT silently overwrite the original data with default', () => {
    // Pre-fix: parseStored caught migrate-throw and returned defaultValue,
    // then writeUpgrade fired regardless — writing the default back to
    // storage. So a buggy migrate function silently destroyed the user's
    // existing data across every session and cross-tab apply. Fix: the
    // `succeeded` flag suppresses writeUpgrade on a fall-back.
    const original = JSON.stringify({ __pv: 1, d: JSON.stringify({ user: 'ada', kept: true }) });
    localStorage.setItem('cart', original);
    const sig = localSignal<{ user: string; kept: boolean }>(
      'cart',
      { user: '', kept: false },
      {
        version: 2,
        migrate: () => {
          throw new Error('migrate is buggy');
        },
      },
    );
    // The accessor falls back to default in memory (no crash) …
    expect(sig()).toEqual({ user: '', kept: false });
    // … but the ORIGINAL bytes MUST still be in storage, untouched, so
    // the dev can debug and ship a real migrate later without losing
    // the data.
    expect(localStorage.getItem('cart')).toBe(original);
  });
});
