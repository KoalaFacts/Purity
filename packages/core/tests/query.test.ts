// @vitest-environment jsdom
// ADR 0048 — query() SWR helper tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateQuery, query, watch } from '../src/index.ts';
import { _resetBfcacheRestoreSignal } from '../src/bfcache-restore-signal.ts';
import { _resetOnlineSignal } from '../src/online-signal.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
import { _resetQueryCache } from '../src/query.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

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

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));
const drain = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await tick();
};

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

beforeEach(() => {
  _resetQueryCache();
  _resetPageVisibilitySignal();
  _resetOnlineSignal();
  _resetBfcacheRestoreSignal();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  _resetQueryCache();
  _resetPageVisibilitySignal();
  _resetOnlineSignal();
  _resetBfcacheRestoreSignal();
});

describe('query — basic shape (ADR 0048)', () => {
  it('returns a ResourceAccessor-compatible accessor', async () => {
    const q = query({
      key: 'q1',
      fetcher: () => Promise.resolve(42),
    });
    expect(q.loading()).toBe(true);
    expect(q()).toBeUndefined();
    await drain();
    expect(q.loading()).toBe(false);
    expect(q()).toBe(42);
    expect(q.error()).toBeUndefined();
  });

  it('passes the key into the fetcher', async () => {
    let receivedKey: unknown = null;
    query({
      key: ['user', 7],
      fetcher: (key) => {
        receivedKey = key;
        return Promise.resolve(null);
      },
    });
    await drain();
    expect(receivedKey).toEqual(['user', 7]);
  });

  it('participates in reactive reads', async () => {
    const q = query({ key: 'react', fetcher: () => Promise.resolve('hello') });
    const seen: (string | undefined)[] = [];
    const dispose = watch(() => seen.push(q()));
    await drain();
    expect(seen).toEqual([undefined, 'hello']);
    dispose();
  });
});

describe('query — cache dedup (ADR 0048)', () => {
  it('same string key returns the same accessor', () => {
    const a = query({ key: 'shared', fetcher: () => Promise.resolve(1) });
    const b = query({ key: 'shared', fetcher: () => Promise.resolve(2) });
    expect(a).toBe(b);
  });

  it('same array key returns the same accessor', () => {
    const a = query({ key: ['user', 1], fetcher: () => Promise.resolve('A') });
    const b = query({ key: ['user', 1], fetcher: () => Promise.resolve('B') });
    expect(a).toBe(b);
  });

  it('different keys get distinct accessors', () => {
    const a = query({ key: 'a', fetcher: () => Promise.resolve(1) });
    const b = query({ key: 'b', fetcher: () => Promise.resolve(2) });
    expect(a).not.toBe(b);
  });

  it('first call wins on fetcher — second is ignored', async () => {
    const seenBy: string[] = [];
    const a = query({
      key: 'fetcher-wins',
      fetcher: () => {
        seenBy.push('first');
        return Promise.resolve(1);
      },
    });
    const b = query({
      key: 'fetcher-wins',
      fetcher: () => {
        seenBy.push('second');
        return Promise.resolve(2);
      },
    });
    await drain();
    expect(a).toBe(b);
    expect(a()).toBe(1);
    expect(seenBy).toEqual(['first']);
  });

  it('warns when a second call passes a different staleTime', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    query({ key: 'warn', fetcher: () => Promise.resolve(0), staleTime: 1000 });
    query({ key: 'warn', fetcher: () => Promise.resolve(0), staleTime: 5000 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("query('warn')");
    expect(warnSpy.mock.calls[0][0]).toContain('staleTime');
    warnSpy.mockRestore();
  });

  it('does not warn when configs match', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    query({ key: 'same', fetcher: () => Promise.resolve(0), staleTime: 1000 });
    query({ key: 'same', fetcher: () => Promise.resolve(0), staleTime: 1000 });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('query — SWR triggers (ADR 0048)', () => {
  it('refreshes on visibility hidden → visible', async () => {
    let calls = 0;
    const q = query({
      key: 'visible',
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
    });
    await drain();
    expect(q()).toBe(1);

    setVisibility('hidden');
    await tick();
    setVisibility('visible');
    await drain();
    expect(q()).toBe(2);
  });

  it('refreshes on online (offline → online)', async () => {
    let calls = 0;
    const q = query({
      key: 'reconnect',
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
    });
    await drain();
    expect(q()).toBe(1);

    setOnline(false);
    await tick();
    setOnline(true);
    await drain();
    expect(q()).toBe(2);
  });

  it('refreshes on bfcache restore', async () => {
    let calls = 0;
    const q = query({
      key: 'bfcache',
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
    });
    await drain();
    expect(q()).toBe(1);

    const e = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(e, 'persisted', { value: true });
    window.dispatchEvent(e);
    await drain();
    expect(q()).toBe(2);
  });

  it('honours revalidateOnVisible: false (per-entry opt-out)', async () => {
    let calls = 0;
    const q = query({
      key: 'no-visible',
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
      revalidateOnVisible: false,
    });
    await drain();
    expect(q()).toBe(1);

    setVisibility('hidden');
    await tick();
    setVisibility('visible');
    await drain();
    expect(q()).toBe(1); // unchanged — trigger opted out
  });

  it('respects staleTime debounce', async () => {
    let calls = 0;
    const q = query({
      key: 'stale',
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
      staleTime: 60_000, // 1 minute — entry stays fresh
    });
    await drain();
    expect(q()).toBe(1);

    setVisibility('hidden');
    await tick();
    setVisibility('visible');
    await drain();
    expect(q()).toBe(1); // skipped — entry still fresh
  });
});

describe('query — invalidate (ADR 0048)', () => {
  it('invalidateQuery refreshes the entry', async () => {
    let calls = 0;
    const q = query({
      key: 'inv',
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
    });
    await drain();
    expect(q()).toBe(1);

    invalidateQuery('inv');
    await drain();
    expect(q()).toBe(2);
  });

  it('invalidateQuery for an unknown key is a no-op', () => {
    expect(() => invalidateQuery('nonexistent')).not.toThrow();
  });

  it('invalidateQuery bypasses staleTime', async () => {
    let calls = 0;
    const q = query({
      key: 'inv-stale',
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
      staleTime: 60_000,
    });
    await drain();
    expect(q()).toBe(1);

    invalidateQuery('inv-stale');
    await drain();
    expect(q()).toBe(2);
  });

  it('invalidateQuery accepts array keys', async () => {
    let calls = 0;
    const q = query({
      key: ['list', 1],
      fetcher: () => {
        calls++;
        return Promise.resolve(calls);
      },
    });
    await drain();
    expect(q()).toBe(1);

    invalidateQuery(['list', 1]);
    await drain();
    expect(q()).toBe(2);
  });
});

describe('query — SSR (ADR 0048)', () => {
  it('delegates to resource() under an SSR context (no triggers wired)', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const q = query({
        key: 'ssr',
        fetcher: () => Promise.resolve(99),
        initialValue: 0,
      });
      // SSR path: same accessor shape, fetch pending registered on the context.
      expect(q()).toBe(0);
      expect(ctx.pendingPromises.length).toBeGreaterThanOrEqual(1);
    } finally {
      popSSRRenderContext();
    }
  });
});
