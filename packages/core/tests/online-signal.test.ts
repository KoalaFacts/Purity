// @vitest-environment jsdom
// ADR 0041 — onlineSignal tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onlineSignal, watch } from '../src/index.ts';
import { _resetOnlineSignal } from '../src/online-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

beforeEach(() => {
  _resetOnlineSignal();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  _resetOnlineSignal();
});

describe('onlineSignal (ADR 0041)', () => {
  it('returns a constant `true` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(onlineSignal()()).toBe(true);
    } finally {
      popSSRRenderContext();
    }
  });

  it('reflects navigator.onLine on first read', () => {
    expect(onlineSignal()()).toBe(true);
  });

  it('flips on online/offline events', async () => {
    const s = onlineSignal();
    const seen: boolean[] = [];
    const dispose = watch(() => seen.push(s()));
    window.dispatchEvent(new Event('offline'));
    await tick();
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(seen).toEqual([true, false, true]);
    dispose();
  });

  it('returns the same singleton across calls', () => {
    expect(onlineSignal()).toBe(onlineSignal());
  });

  it('does not throw when `navigator` is undefined', () => {
    const orig = globalThis.navigator;
    // Hide navigator without deleting from window so the early-return path triggers.
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    try {
      expect(() => onlineSignal()()).not.toThrow();
      expect(onlineSignal()()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: orig });
    }
  });

  it('coerces a non-boolean `navigator.onLine` to a boolean', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => undefined as unknown as boolean,
    });
    const v = onlineSignal()();
    expect(typeof v).toBe('boolean');
    expect(v).toBe(false);
  });

  it('_resetOnlineSignal detaches listeners (no leak across resets)', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    try {
      onlineSignal();
      const addsAfterFirst = addSpy.mock.calls.filter(
        (c) => c[0] === 'online' || c[0] === 'offline',
      ).length;
      expect(addsAfterFirst).toBe(2);

      _resetOnlineSignal();
      const removes = removeSpy.mock.calls.filter(
        (c) => c[0] === 'online' || c[0] === 'offline',
      ).length;
      expect(removes).toBe(2);

      // Re-binding after reset adds exactly two more listeners — no drift.
      onlineSignal();
      const addsAfterSecond = addSpy.mock.calls.filter(
        (c) => c[0] === 'online' || c[0] === 'offline',
      ).length;
      expect(addsAfterSecond).toBe(4);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('isolates throws inside a downstream watcher from the dispatch loop', async () => {
    const s = onlineSignal();
    const errors: unknown[] = [];
    const consoleErr = vi.spyOn(console, 'error').mockImplementation((e) => errors.push(e));
    const seen: boolean[] = [];
    let threwOnce = false;
    const dispose = watch(() => {
      const v = s();
      seen.push(v);
      if (!v && !threwOnce) {
        threwOnce = true;
        throw new Error('boom');
      }
    });
    try {
      window.dispatchEvent(new Event('offline'));
      await tick();
      // Signal still reactive after a watcher throws — flip back to online still observable.
      window.dispatchEvent(new Event('online'));
      await tick();
      expect(seen).toContain(false);
      expect(seen[seen.length - 1]).toBe(true);
    } finally {
      dispose();
      consoleErr.mockRestore();
    }
  });
});
