// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { _resetBfcacheRestoreSignal } from '../src/browser-signals/bfcache-restore-signal.ts';
import { _resetOnlineSignal, onlineSignal } from '../src/browser-signals/online-signal.ts';
import {
  _resetPageVisibilitySignal,
  pageVisibilitySignal,
} from '../src/browser-signals/page-visibility-signal.ts';
import { invalidateQuery, query, _resetQueryCache } from '../src/query.ts';
import {
  ComponentContext,
  getCurrentComponent,
  getCurrentContext,
  popContext,
  pushContext,
  withoutScope,
} from '@purityjs/signals';
import { disposeScope, watch } from '@purityjs/signals';

const drain = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>(queueMicrotask);
};

afterEach(() => {
  _resetQueryCache();
  _resetPageVisibilitySignal();
  _resetOnlineSignal();
  _resetBfcacheRestoreSignal();
});

describe('query cache ownership', () => {
  it('restores the consumer scope after nested shared initialization throws', () => {
    const owner = new ComponentContext();
    const failure = new Error('initialization failed');
    pushContext(owner);
    try {
      expect(() =>
        withoutScope(() => {
          expect(getCurrentContext()).toBeNull();
          expect(getCurrentComponent()).toBeNull();
          withoutScope(() => {
            throw failure;
          });
        }),
      ).toThrow(failure);
      expect(getCurrentContext()).toBe(owner);
      expect(getCurrentComponent()).toBe(owner);
    } finally {
      popContext();
    }
  });

  it('keeps the existing consumer and a remounted consumer refreshable after the creator stops', async () => {
    let calls = 0;
    const options = { key: 'shared-owner', fetcher: () => ++calls };
    let a!: ReturnType<typeof query<number>>;
    let b!: typeof a;
    let c!: typeof a;
    const stopA = watch(() => {
      a = query(options);
    });
    const stopB = watch(() => {
      b = query(options);
    });
    let stopC = () => {};
    try {
      expect(a).toBe(b);
      expect(calls).toBe(1);
      invalidateQuery(options.key);
      await drain();
      expect(b()).toBe(2);
      stopA();
      invalidateQuery(options.key);
      await drain();
      expect(calls).toBe(3);
      expect(b()).toBe(3);
      stopB();
      stopC = watch(() => {
        c = query(options);
      });
      expect(c).toBe(b);
      invalidateQuery(options.key);
      await drain();
      expect(calls).toBe(4);
      expect(c()).toBe(4);
    } finally {
      stopA();
      stopB();
      stopC();
    }
  });

  it('keeps browser revalidation wired after the creator stops', async () => {
    let calls = 0;
    let ownerRuns = 0;
    let q!: ReturnType<typeof query<number>>;
    const stop = watch(() => {
      ownerRuns++;
      q = query({ key: 'trigger-owner', fetcher: () => ++calls });
    });
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    window.dispatchEvent(restored);
    await drain();
    expect(ownerRuns).toBe(1);
    stop();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await drain();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await drain();
    expect(q()).toBe(3);
    window.dispatchEvent(new Event('offline'));
    await drain();
    window.dispatchEvent(new Event('online'));
    await drain();
    expect(q()).toBe(4);
    window.dispatchEvent(restored);
    await drain();
    expect(q()).toBe(5);
  });

  it.each(['visibility', 'online'] as const)(
    'survives a disposed consumer that prewarmed %s',
    async (trigger) => {
      const stop = watch(() => {
        if (trigger === 'visibility') pageVisibilitySignal()();
        else onlineSignal()();
      });
      stop();
      let calls = 0;
      const q = query({ key: 'prewarmed', fetcher: () => ++calls });
      if (trigger === 'visibility') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        await drain();
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        window.dispatchEvent(new Event('offline'));
        await drain();
        window.dispatchEvent(new Event('online'));
      }
      await drain();
      expect(q()).toBe(2);
    },
  );

  it('retains shared in-flight work until refresh or cache reset cancels it', async () => {
    const runs: { signal: AbortSignal; resolve: (n: number) => void; aborts: number }[] = [];
    const options = {
      key: 'pending-owner',
      fetcher: (_key: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise<number>((resolve) => {
          const run = { signal, resolve, aborts: 0 };
          signal.addEventListener('abort', () => run.aborts++, { once: true });
          runs.push(run);
        }),
    };
    let q!: ReturnType<typeof query<number>>;
    const stopA = watch(() => {
      q = query(options);
    });
    const stopB = watch(() => {
      query(options);
    });
    try {
      stopA();
      expect(runs[0].signal.aborted).toBe(false);
      invalidateQuery(options.key);
      await drain();
      expect(runs).toHaveLength(2);
      expect(runs[0].aborts).toBe(1);
      runs[0].resolve(10);
      await drain();
      expect(q()).toBeUndefined();
      _resetQueryCache();
      expect(runs[1].signal.aborted).toBe(true);
      expect(runs[1].aborts).toBe(1);
      expect(q.loading()).toBe(false);
      runs[1].resolve(20);
      await drain();
      expect(q()).toBeUndefined();
      q.refresh();
      await drain();
      expect(runs).toHaveLength(2);
    } finally {
      stopA();
      stopB();
    }
  });

  it('keeps explicit disposal terminal and aborts the shared request once', async () => {
    let signal!: AbortSignal;
    let calls = 0;
    let aborts = 0;
    let q!: ReturnType<typeof query<number>>;
    const stop = watch(() => {
      q = query({
        key: 'explicit-stop',
        fetcher: (_key, info) => {
          calls++;
          signal = info.signal;
          signal.addEventListener('abort', () => aborts++, { once: true });
          return new Promise<number>(() => {});
        },
      });
    });
    stop();
    expect(signal.aborted).toBe(false);
    q.dispose();
    q.dispose();
    expect(signal.aborted).toBe(true);
    expect(aborts).toBe(1);
    expect(q.loading()).toBe(false);
    invalidateQuery('explicit-stop');
    q.refresh();
    await drain();
    expect(calls).toBe(1);
    _resetQueryCache();
    expect(aborts).toBe(1);
  });

  it('binds shared loading and error states to each consumer without retaining a disposed host', async () => {
    const a = new ComponentContext(),
      b = new ComponentContext();
    const statesA = new Set<string>(),
      statesB = new Set<string>();
    a._internals = { states: statesA } as unknown as ElementInternals;
    b._internals = { states: statesB } as unknown as ElementInternals;
    let reject!: (reason: unknown) => void;
    const options = {
      key: 'host-state',
      fetcher: () =>
        new Promise<number>((_resolve, fail) => {
          reject = fail;
        }),
    };
    let q!: ReturnType<typeof query<number>>;
    pushContext(a);
    try {
      q = query(options);
    } finally {
      popContext();
    }
    pushContext(b);
    try {
      expect(query(options)).toBe(q);
    } finally {
      popContext();
    }
    expect(statesA.has('loading')).toBe(true);
    expect(statesB.has('loading')).toBe(true);
    disposeScope(a);
    expect(statesA.has('loading')).toBe(false);
    expect(statesB.has('loading')).toBe(true);
    reject(new Error('fetch failed'));
    await drain();
    expect(statesA.size).toBe(0);
    expect(statesB.has('loading')).toBe(false);
    expect(statesB.has('error')).toBe(true);
    disposeScope(b);
    expect(statesB.size).toBe(0);
  });
});
