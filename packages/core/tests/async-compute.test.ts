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

  it('names the unresolved value as the PendingError source, also through a compute()', () => {
    const value = asyncCompute(() => new Promise<number>(() => {}));
    const derived = compute(() => value() + 1);
    let caught: unknown;
    try {
      derived();
    } catch (error) {
      caught = error;
    }
    expect(isPending(caught) && caught.source).toBe(value);
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

  it('ignores a rejection that its own supersession abort caused', async () => {
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

  it('a chained asyncCompute re-runs only when the upstream settles to a new value', async () => {
    const id = state(1);
    const ups: ReturnType<typeof deferred<number>>[] = [];
    const a = asyncCompute(() => {
      id();
      const d = deferred<number>();
      ups.push(d);
      return d.promise;
    });
    const inputs: number[] = [];
    const b = asyncCompute(() => {
      const v = a();
      inputs.push(v);
      return Promise.resolve(v * 10);
    });
    expect(b.pending()).toBe(true);
    ups[0].resolve(1);
    await flush();
    expect(b.pending()).toBe(true);
    await flush();
    expect(b()).toBe(10);
    id(2);
    // a refetches with its retained value; b must not refetch with it.
    expect(b()).toBe(10);
    ups[1].resolve(2);
    await flush();
    expect(b()).toBe(10);
    await flush();
    expect(b()).toBe(20);
    expect(inputs).toEqual([1, 2]);
  });

  it('a chained asyncCompute does not re-run when the upstream re-settles to an equal value', async () => {
    const other = state(0);
    const a = asyncCompute(() => {
      other();
      return Promise.resolve('small');
    });
    const inputs: string[] = [];
    const b = asyncCompute(() => {
      const v = a();
      inputs.push(v);
      return Promise.resolve(`${v}!`);
    });
    // A live reader keeps the chain eager (computes are pull-based).
    const stop = watch(() => void outcome(b));
    await flush();
    await flush();
    expect(b()).toBe('small!');
    other(1);
    expect(a.pending()).toBe(true);
    await flush();
    expect(a.pending()).toBe(false);
    expect(a()).toBe('small');
    await flush();
    expect(b()).toBe('small!');
    expect(b.pending()).toBe(false);
    expect(inputs).toEqual(['small']);
    stop();
  });

  it('an async fn reading an unresolved upstream stays pending until the upstream settles', async () => {
    const up = deferred<number>();
    const a = asyncCompute(() => up.promise);
    const b = asyncCompute(async () => {
      const v = a();
      return v * 2;
    });
    const stop = watch(() => void outcome(b));
    await flush();
    expect(b.pending()).toBe(true);
    expect(() => b()).toThrow(PendingError);
    up.resolve(4);
    await flush();
    await flush();
    expect(b.pending()).toBe(false);
    expect(b()).toBe(8);
    stop();
  });

  it('an unguarded watch read of an unresolved value throws from watch()', () => {
    const value = asyncCompute(() => new Promise<number>(() => {}));
    expect(() => watch(() => void value())).toThrow(PendingError);
  });

  it('dispose() before any settlement: reads keep throwing PendingError', () => {
    const value = asyncCompute(() => new Promise<number>(() => {}));
    expect(value.pending()).toBe(true);
    value.dispose();
    expect(() => value()).toThrow(PendingError);
    expect(value.pending()).toBe(false);
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

describe('asyncCompute AsyncIterable edge cases (ADR 0054 slice 2)', () => {
  it('Object.is-equal yields do not re-run readers', async () => {
    const value = asyncCompute(async function* () {
      yield 1;
      yield 1;
      yield 2;
    });
    let runs = 0;
    const derived = compute(() => {
      runs++;
      return outcome(value);
    });
    const seen: unknown[] = [];
    const stop = watch(() => {
      seen.push(derived());
    });
    await flush();
    await flush();
    expect(seen).toEqual(['pending', 1, 2]);
    expect(runs).toBe(3);
    stop();
  });

  it('a stale iterator rejection after supersession is ignored', async () => {
    const id = state(1);
    const gates: Array<(e: unknown) => void> = [];
    const value = asyncCompute(() => {
      const key = id();
      return (async function* () {
        yield key;
        await new Promise((_, reject) => gates.push(reject));
      })();
    });
    const stop = watch(() => {
      outcome(value);
    });
    await flush();
    id(2);
    await flush();
    gates[0]!(new Error('stale'));
    await flush();
    expect(value()).toBe(2);
    stop();
    value.dispose();
  });

  it('an iterator rejecting with PendingError stays pending', async () => {
    const upstream = asyncCompute(() => new Promise<number>(() => {}));
    const value = asyncCompute(async function* () {
      yield upstream();
    });
    const stop = watch(() => {
      outcome(value);
    });
    await flush();
    expect(() => value()).toThrow(PendingError);
    expect(value.pending()).toBe(true);
    stop();
  });

  it('a thenable result wins over an async iterator on the same object', async () => {
    const both = Object.assign(Promise.resolve(7), {
      async *[Symbol.asyncIterator]() {
        yield 99;
      },
    });
    const value = asyncCompute(() => both);
    const stop = watch(() => {
      outcome(value);
    });
    await flush();
    expect(value()).toBe(7);
    stop();
  });
});
