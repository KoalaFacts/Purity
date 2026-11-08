import { describe, expect, it } from 'vite-plus/test';
import { compute, disposeScope, popContext, pushContext, state, watch } from '@purityjs/signals';
import type { Scope } from '@purityjs/signals';
import { asyncCompute, isPending } from '../src/async.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));
const flush = async () => {
  for (let i = 0; i < 8; i++) await tick();
};

function outcome(read: () => unknown): unknown {
  try {
    return read();
  } catch (e) {
    return isPending(e) ? 'pending' : `error:${(e as Error).message}`;
  }
}

// An async iterator whose next values are pushed by the test.
function channel<T>() {
  const queue: Array<IteratorResult<T> | { error: unknown }> = [];
  let wake: (() => void) | null = null;
  let closed = 0;
  const push = (item: IteratorResult<T> | { error: unknown }) => {
    queue.push(item);
    wake?.();
    wake = null;
  };
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (queue.length === 0) await new Promise<void>((r) => (wake = r));
          const item = queue.shift()!;
          if ('error' in item) throw item.error;
          return item;
        },
        async return() {
          closed++;
          return { done: true, value: undefined };
        },
      };
    },
  };
  return {
    iterable,
    yieldValue: (value: T) => push({ done: false, value }),
    end: () => push({ done: true, value: undefined }),
    fail: (error: unknown) => push({ error }),
    closed: () => closed,
  };
}

describe('asyncCompute AsyncIterable results (ADR 0054, SV2-003 slice 2)', () => {
  it('each yielded value becomes current; downstream sees pending then every value', async () => {
    const ch = channel<number>();
    const value = asyncCompute(() => ch.iterable);
    const doubled = compute(() => value() * 2);
    const seen: unknown[] = [];
    const stop = watch(() => {
      seen.push(outcome(doubled));
    });
    expect(seen).toEqual(['pending']);
    expect(value.pending()).toBe(true);
    ch.yieldValue(1);
    await flush();
    expect(value.pending()).toBe(false);
    ch.yieldValue(2);
    await flush();
    ch.yieldValue(3);
    await flush();
    expect(seen).toEqual(['pending', 2, 4, 6]);
    ch.end();
    await flush();
    expect(value()).toBe(3);
    expect(ch.closed()).toBe(0);
    stop();
    value.dispose();
  });

  it('works with async generators and runs their finally block on supersession', async () => {
    const id = state('a');
    const finished: string[] = [];
    const gates: Record<string, Array<() => void>> = { a: [], b: [] };
    const wait = (key: string) => new Promise<void>((r) => gates[key].push(r));
    const value = asyncCompute(() => {
      const key = id();
      return (async function* () {
        try {
          yield `${key}1`;
          await wait(key);
          yield `${key}2`;
        } finally {
          finished.push(key);
        }
      })();
    });
    const seen: unknown[] = [];
    const stop = watch(() => {
      seen.push(outcome(value));
    });
    await flush();
    expect(seen).toEqual(['pending', 'a1']);
    id('b');
    // The superseded run keeps its retained value until the new run yields.
    expect(value()).toBe('a1');
    await flush();
    expect(seen).toEqual(['pending', 'a1', 'b1']);
    // A generator suspended on an await closes once that await settles
    // (JS queues return() behind it); its next value is never delivered.
    expect(finished).toEqual([]);
    for (const release of gates.a) release();
    await flush();
    expect(finished).toEqual(['a']);
    expect(seen).toEqual(['pending', 'a1', 'b1']);
    stop();
    value.dispose();
    for (const release of gates.b) release();
    await flush();
    expect(finished).toEqual(['a', 'b']);
    expect(seen).toEqual(['pending', 'a1', 'b1']);
  });

  it('ignores values from a superseded iterator whose return() does not stop next()', async () => {
    const id = state(1);
    const first = channel<string>();
    const second = channel<string>();
    const value = asyncCompute(() => (id() === 1 ? first : second).iterable);
    const stop = watch(() => void outcome(value));
    first.yieldValue('one');
    await flush();
    id(2);
    await flush();
    expect(first.closed()).toBe(1);
    first.yieldValue('stale');
    second.yieldValue('two');
    await flush();
    expect(value()).toBe('two');
    stop();
    value.dispose();
  });

  it('dispose() closes the iterator and stops delivering values', async () => {
    const ch = channel<number>();
    const value = asyncCompute(() => ch.iterable);
    const stop = watch(() => void outcome(value));
    ch.yieldValue(1);
    await flush();
    value.dispose();
    expect(ch.closed()).toBe(1);
    ch.yieldValue(2);
    await flush();
    expect(value()).toBe(1);
    expect(value.pending()).toBe(false);
    stop();
  });

  it('owner scope disposal closes the iterator', async () => {
    const ch = channel<number>();
    const scope: Scope = { disposers: null } as Scope;
    pushContext(scope);
    const value = asyncCompute(() => ch.iterable);
    popContext();
    const stop = watch(() => void outcome(value));
    ch.yieldValue(1);
    await flush();
    disposeScope(scope);
    expect(ch.closed()).toBe(1);
    stop();
  });

  it('an iterator rejection becomes the current error', async () => {
    const ch = channel<number>();
    const value = asyncCompute(() => ch.iterable);
    const seen: unknown[] = [];
    const stop = watch(() => {
      seen.push(outcome(value));
    });
    ch.yieldValue(1);
    await flush();
    ch.fail(new Error('stream broke'));
    await flush();
    expect(seen).toEqual(['pending', 1, 'error:stream broke']);
    expect(value.pending()).toBe(false);
    stop();
    value.dispose();
  });

  it('an iterator that ends without yielding stays pending', async () => {
    const ch = channel<number>();
    const value = asyncCompute(() => ch.iterable);
    const stop = watch(() => void outcome(value));
    ch.end();
    await flush();
    expect(outcome(value)).toBe('pending');
    stop();
    value.dispose();
  });

  it('keeps a Promise result settling on the next microtask (no extra wrapping)', async () => {
    let resolve!: (v: number) => void;
    const p = new Promise<number>((r) => (resolve = r));
    const value = asyncCompute(() => p);
    expect(outcome(value)).toBe('pending');
    resolve(9);
    await p;
    expect(value()).toBe(9);
    value.dispose();
  });

  it('leaves an onabort handler set by fn in place, for promises and iterators', async () => {
    const id = state(1);
    let aborts = 0;
    const promised = asyncCompute(({ signal }) => {
      id();
      signal.onabort = () => aborts++;
      return new Promise<number>(() => {});
    });
    const ch = channel<number>();
    const streamed = asyncCompute(({ signal }) => {
      id();
      signal.onabort = () => aborts++;
      return ch.iterable;
    });
    const stop = watch(() => {
      outcome(promised);
      outcome(streamed);
    });
    id(2);
    await flush();
    expect(aborts).toBe(2);
    expect(ch.closed()).toBe(1);
    stop();
    promised.dispose();
    streamed.dispose();
  });

  it('tracks reads an async generator makes before its first await', async () => {
    const id = state('a');
    const value = asyncCompute(() =>
      (async function* () {
        const key = id();
        yield key;
      })(),
    );
    const stop = watch(() => void outcome(value));
    await flush();
    expect(value()).toBe('a');
    id('b');
    await flush();
    expect(value()).toBe('b');
    stop();
    value.dispose();
  });
});
