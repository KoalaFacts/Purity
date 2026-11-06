import { describe, expect, it } from 'vite-plus/test';
import { compute, disposeScope, popContext, pushContext, state, watch } from '@purityjs/signals';
import type { Scope } from '@purityjs/signals';
import { asyncCompute, isPending, PendingError } from '../src/async.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));
const flush = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Read a value or describe what was thrown, for watch traces.
function outcome(read: () => unknown): unknown {
  try {
    return read();
  } catch (e) {
    return isPending(e) ? 'pending' : `error:${(e as Error).message}`;
  }
}

describe('asyncCompute (ADR 0054)', () => {
  it('source -> async -> sync compute -> watch never sees undefined or a Promise', async () => {
    const id = state(1);
    const user = asyncCompute(() => Promise.resolve({ name: `user${id()}` }));
    const greeting = compute(() => `Hello, ${user().name}`);
    const seen: unknown[] = [];
    const stop = watch(() => {
      seen.push(outcome(greeting));
    });
    expect(seen).toEqual(['pending']);
    await flush();
    expect(seen).toEqual(['pending', 'Hello, user1']);
    id(2);
    await flush();
    // Retained content: the refetch never surfaces as pending.
    expect(seen).toEqual(['pending', 'Hello, user1', 'Hello, user2']);
    stop();
  });

  it('throws PendingError before the first settlement', () => {
    const value = asyncCompute(() => new Promise<number>(() => {}));
    expect(() => value()).toThrow(PendingError);
    expect(value.pending()).toBe(true);
  });

  it('settles synchronous results in the same read', () => {
    const n = state(2);
    const doubled = asyncCompute(() => n() * 2);
    expect(doubled()).toBe(4);
    expect(doubled.pending()).toBe(false);
    n(5);
    expect(doubled()).toBe(10);
  });

  it('only the latest run becomes current when an older run resolves last', async () => {
    const key = state('a');
    const runs: Record<string, ReturnType<typeof deferred<string>>> = {};
    const signals: Record<string, AbortSignal> = {};
    const value = asyncCompute(({ signal }) => {
      const k = key();
      signals[k] = signal;
      return (runs[k] = deferred<string>()).promise;
    });
    expect(value.pending()).toBe(true);
    key('b');
    expect(value.pending()).toBe(true);
    expect(signals.a.aborted).toBe(true);
    expect(signals.b.aborted).toBe(false);
    runs.b.resolve('B');
    await flush();
    expect(value()).toBe('B');
    runs.a.resolve('A');
    await flush();
    expect(value()).toBe('B');
    expect(value.pending()).toBe(false);
  });

  it('keeps the previous value while a refetch is pending', async () => {
    const key = state(1);
    const runs: ReturnType<typeof deferred<number>>[] = [];
    const value = asyncCompute(() => {
      key();
      const d = deferred<number>();
      runs.push(d);
      return d.promise;
    });
    expect(value.pending()).toBe(true);
    runs[0].resolve(10);
    await flush();
    expect(value()).toBe(10);
    key(2);
    expect(value()).toBe(10);
    expect(value.pending()).toBe(true);
    runs[1].resolve(20);
    await flush();
    expect(value()).toBe(20);
    expect(value.pending()).toBe(false);
  });

  it('rethrows a rejection of the latest run through downstream computes; success clears it', async () => {
    const key = state(1);
    const runs: ReturnType<typeof deferred<number>>[] = [];
    const value = asyncCompute(() => {
      key();
      const d = deferred<number>();
      runs.push(d);
      return d.promise;
    });
    const plusOne = compute(() => value() + 1);
    expect(() => plusOne()).toThrow(PendingError);
    runs[0].reject(new Error('boom'));
    await flush();
    expect(() => plusOne()).toThrow('boom');
    expect(value.pending()).toBe(false);
    key(2);
    expect(outcome(plusOne)).toBe('error:boom');
    runs[1].resolve(1);
    await flush();
    expect(plusOne()).toBe(2);
  });

  it('ignores a stale rejection and an abort-caused rejection', async () => {
    const key = state('a');
    const runs: Record<string, ReturnType<typeof deferred<string>>> = {};
    const value = asyncCompute(({ signal }) => {
      const k = key();
      const d = (runs[k] = deferred<string>());
      signal.addEventListener('abort', () => d.reject(new Error(`aborted ${k}`)));
      return d.promise;
    });
    expect(value.pending()).toBe(true);
    key('b');
    expect(value.pending()).toBe(true);
    await flush();
    expect(() => value()).toThrow(PendingError);
    runs.b.resolve('B');
    await flush();
    expect(value()).toBe('B');
  });

  it('turns a synchronous throw into the current error', () => {
    const value = asyncCompute((): number => {
      throw new Error('sync');
    });
    expect(() => value()).toThrow('sync');
    expect(value.pending()).toBe(false);
  });

  it('dispose() aborts the in-flight run and ignores its settlement', async () => {
    let signal!: AbortSignal;
    const d = deferred<number>();
    const value = asyncCompute((info) => {
      signal = info.signal;
      return d.promise;
    });
    expect(() => value()).toThrow(PendingError);
    value.dispose();
    expect(signal.aborted).toBe(true);
    d.resolve(1);
    await flush();
    expect(() => value()).toThrow(PendingError);
  });

  it('disposing the owning scope aborts the in-flight run', async () => {
    const scope: Scope = { disposers: null } as Scope;
    pushContext(scope);
    let signal!: AbortSignal;
    const d = deferred<number>();
    const value = asyncCompute((info) => {
      signal = info.signal;
      return d.promise;
    });
    popContext();
    expect(() => value()).toThrow(PendingError);
    disposeScope(scope);
    expect(signal.aborted).toBe(true);
    d.resolve(1);
    await flush();
    expect(() => value()).toThrow(PendingError);
  });

  it('chains async values: an unresolved upstream keeps the downstream pending', async () => {
    const up = deferred<number>();
    const a = asyncCompute(() => up.promise);
    const b = asyncCompute(() => Promise.resolve(a() * 10));
    expect(() => b()).toThrow(PendingError);
    expect(b.pending()).toBe(true);
    up.resolve(4);
    await flush();
    // The upstream settlement re-runs b on the next read.
    expect(() => b()).toThrow(PendingError);
    await flush();
    expect(b()).toBe(40);
    expect(b.pending()).toBe(false);
  });

  it('settles a synchronously calling thenable after the read, not inside it', async () => {
    const thenable = {
      then(resolve: (v: number) => void) {
        resolve(7);
      },
    } as unknown as PromiseLike<number>;
    const value = asyncCompute(() => thenable);
    expect(() => value()).toThrow(PendingError);
    await flush();
    expect(value()).toBe(7);
  });

  it('does not start a run until it is read', () => {
    let runs = 0;
    const value = asyncCompute(() => {
      runs++;
      return 1;
    });
    expect(runs).toBe(0);
    expect(value()).toBe(1);
    expect(runs).toBe(1);
  });
});
