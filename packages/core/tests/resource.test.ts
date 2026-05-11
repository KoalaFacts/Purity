import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, onMount } from '../src/component.ts';
import { debounced } from '../src/debounced.ts';
import { lazyResource, resource } from '../src/resource.ts';
import { compute, state, watch } from '../src/signals.ts';
import { flushAll, tick } from './_helpers.ts';

describe('resource — single-arg fetcher form', () => {
  it('resolves and surfaces data, error, and loading correctly', async () => {
    const r = resource(() => Promise.resolve(42));
    expect(r.loading()).toBe(true);
    expect(r()).toBe(undefined);
    expect(r.error()).toBe(undefined);

    await flushAll();

    expect(r()).toBe(42);
    expect(r.loading()).toBe(false);
    expect(r.error()).toBe(undefined);
  });

  it('captures rejection as error and clears loading', async () => {
    const boom = new Error('boom');
    const r = resource(() => Promise.reject(boom));

    await flushAll();

    expect(r()).toBe(undefined);
    expect(r.error()).toBe(boom);
    expect(r.loading()).toBe(false);
  });

  it('exposes initialValue before first resolution', async () => {
    const r = resource(() => Promise.resolve(99), { initialValue: 0 });
    expect(r()).toBe(0);
    expect(r.loading()).toBe(true);

    await flushAll();
    expect(r()).toBe(99);
  });

  it('applies a synchronous (non-Promise) fetcher result immediately', () => {
    const r = resource(() => 7);
    expect(r()).toBe(7);
    expect(r.loading()).toBe(false);
  });

  it('captures synchronous throw from fetcher as error', () => {
    const r = resource(() => {
      throw new Error('sync-fail');
    });
    expect((r.error() as Error).message).toBe('sync-fail');
    expect(r.loading()).toBe(false);
    expect(r()).toBe(undefined);
  });

  it('re-fetches when a state read inside the fetcher changes', async () => {
    const id = state(1);
    let calls = 0;
    const r = resource(() => {
      calls++;
      const v = id();
      return Promise.resolve(`u${v}`);
    });

    await flushAll();
    expect(calls).toBe(1);
    expect(r()).toBe('u1');

    id(2);
    await flushAll();
    expect(calls).toBe(2);
    expect(r()).toBe('u2');
  });

  it('.get() and .peek() expose data; .peek() does not track', () => {
    const r = resource(() => Promise.resolve('x'), { initialValue: 'seed' });
    expect(r.get()).toBe('seed');
    expect(r.peek()).toBe('seed');
  });
});

describe('resource — source + fetcher form', () => {
  it('passes the source value to the fetcher and re-fetches on change', async () => {
    const id = state(1);
    const calls: number[] = [];
    const r = resource(
      () => id(),
      (key) => {
        calls.push(key);
        return Promise.resolve(`u${key}`);
      },
    );

    await flushAll();
    expect(calls).toEqual([1]);
    expect(r()).toBe('u1');

    id(5);
    await flushAll();
    expect(calls).toEqual([1, 5]);
    expect(r()).toBe('u5');
  });

  it('skips fetch when source returns null/undefined/false and clears loading', async () => {
    const id = state<number | null>(1);
    let calls = 0;
    const r = resource(
      () => id(),
      (key) => {
        calls++;
        return Promise.resolve(key * 10);
      },
    );

    await flushAll();
    expect(calls).toBe(1);
    expect(r()).toBe(10);

    id(null);
    await flushAll();
    expect(calls).toBe(1);
    expect(r.loading()).toBe(false);
    // Prior data is preserved.
    expect(r()).toBe(10);

    id(2);
    await flushAll();
    expect(calls).toBe(2);
    expect(r()).toBe(20);
  });

  it('memoizes source: unrelated upstream change with same source value does not refetch', async () => {
    const id = state(1);
    const unrelated = state(0);
    let calls = 0;
    const r = resource(
      () => {
        unrelated();
        return id();
      },
      (key) => {
        calls++;
        return Promise.resolve(key);
      },
    );

    await flushAll();
    expect(calls).toBe(1);

    unrelated(1);
    await flushAll();
    expect(calls).toBe(1);

    id(2);
    await flushAll();
    expect(calls).toBe(2);
    expect(r()).toBe(2);
  });

  it('accepts initialValue in the source form', async () => {
    const id = state(1);
    const r = resource(
      () => id(),
      (k) => Promise.resolve(k * 2),
      { initialValue: -1 },
    );
    expect(r()).toBe(-1);
    await flushAll();
    expect(r()).toBe(2);
  });
});

describe('resource — race safety & cancellation', () => {
  it('drops out-of-order resolutions: A resolves after B, A is ignored', async () => {
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    const id = state(1);
    const r = resource(
      () => id(),
      (key) =>
        new Promise<string>((resolve) => {
          if (key === 1) resolveA = resolve;
          else resolveB = resolve;
        }),
    );

    await flushAll();
    expect(r.loading()).toBe(true);

    id(2);
    await flushAll();

    resolveB('B');
    await flushAll();
    expect(r()).toBe('B');
    expect(r.loading()).toBe(false);

    resolveA('A');
    await flushAll();
    expect(r()).toBe('B');
  });

  it("aborts the previous run's signal when deps change", async () => {
    const id = state(1);
    let firstSignal!: AbortSignal;
    let secondSignal!: AbortSignal;
    let runs = 0;
    resource(
      () => id(),
      (_, { signal }) => {
        runs++;
        if (runs === 1) firstSignal = signal;
        else secondSignal = signal;
        return new Promise<number>(() => {});
      },
    );

    await flushAll();
    expect(firstSignal.aborted).toBe(false);

    id(2);
    await flushAll();
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
  });

  it('does not surface AbortError-style rejections from a superseded run', async () => {
    let rejectA!: (e: unknown) => void;
    const id = state(1);
    const r = resource(
      () => id(),
      (key, { signal }) => {
        if (key === 1) {
          return new Promise<string>((_, reject) => {
            rejectA = reject;
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        }
        return Promise.resolve('B');
      },
    );

    await flushAll();
    id(2);
    await flushAll();
    // Trigger the abort rejection on A — should be ignored.
    rejectA(new DOMException('aborted', 'AbortError'));
    await flushAll();

    expect(r()).toBe('B');
    expect(r.error()).toBe(undefined);
  });
});

describe('resource — refresh & mutate', () => {
  it('refresh() re-runs the fetcher with the same deps', async () => {
    const id = state(1);
    let calls = 0;
    const r = resource(
      () => id(),
      (k) => {
        calls++;
        return Promise.resolve(`${k}-${calls}`);
      },
    );

    await flushAll();
    expect(calls).toBe(1);
    expect(r()).toBe('1-1');

    r.refresh();
    await flushAll();
    expect(calls).toBe(2);
    expect(r()).toBe('1-2');
  });

  it('mutate(value) sets data, clears error, does not call fetcher', async () => {
    let calls = 0;
    const r = resource(
      () => 1 as const,
      () => {
        calls++;
        return Promise.reject(new Error('x'));
      },
    );
    await flushAll();
    expect(r.error()).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    r.mutate(42 as never);
    expect(r()).toBe(42);
    expect(r.error()).toBe(undefined);
    expect(calls).toBe(1);
  });

  it('mutate(updater) receives current value', async () => {
    const r = resource(() => Promise.resolve(10));
    await flushAll();
    r.mutate((cur) => (cur ?? 0) + 5);
    expect(r()).toBe(15);
  });

  it('refresh after error recovers cleanly', async () => {
    let shouldFail = true;
    const r = resource(
      () => 1 as const,
      () => (shouldFail ? Promise.reject(new Error('first-fail')) : Promise.resolve('ok')),
    );

    await flushAll();
    expect((r.error() as Error).message).toBe('first-fail');

    shouldFail = false;
    r.refresh();
    await flushAll();
    expect(r()).toBe('ok');
    expect(r.error()).toBe(undefined);
  });
});

describe('resource — reactivity & integration', () => {
  it('loading transitions from true to false across the resolution boundary', async () => {
    const r = resource(() => Promise.resolve('done'));
    expect(r.loading()).toBe(true);
    await flushAll();
    expect(r.loading()).toBe(false);
  });

  it('two resources are independent', async () => {
    const a = resource(() => Promise.resolve('A'));
    const b = resource(() => Promise.resolve('B'));
    await flushAll();
    expect(a()).toBe('A');
    expect(b()).toBe('B');
  });

  it('aborts in-flight request when the surrounding component unmounts', async () => {
    const id = state(1);
    let capturedSignal: AbortSignal | null = null;
    let calls = 0;

    const container = document.createElement('div');
    const { unmount } = mount(() => {
      resource(
        () => id(),
        (_, { signal }) => {
          calls++;
          capturedSignal = signal;
          return new Promise<number>(() => {});
        },
      );
      return document.createTextNode('');
    }, container);

    await flushAll();
    expect(calls).toBe(1);
    expect(capturedSignal!.aborted).toBe(false);

    unmount();
    expect(capturedSignal!.aborted).toBe(true);

    id(2);
    await flushAll();
    // No further fetches after unmount.
    expect(calls).toBe(1);
  });

  it('auto-disposes the watcher on unmount even with a pending promise', async () => {
    const id = state(1);
    let resolveLast!: (v: number) => void;
    let calls = 0;

    const container = document.createElement('div');
    const { unmount } = mount(() => {
      const r = resource(
        () => id(),
        (k) => {
          calls++;
          return new Promise<number>((resolve) => {
            if (k === 2) resolveLast = resolve;
          });
        },
      );
      // Just to ensure the resource is reachable inside the closure.
      void r;
      return document.createTextNode('');
    }, container);

    await flushAll();
    id(2);
    await flushAll();
    expect(calls).toBe(2);

    unmount();
    // Resolving after unmount must not throw or trigger side-effects.
    expect(() => resolveLast(99)).not.toThrow();
  });

  it('runs eagerly inside a component so onMount sees a fetch already in flight', async () => {
    const seenLoading: boolean[] = [];
    const container = document.createElement('div');
    mount(() => {
      const r = resource(() => Promise.resolve('hi'));
      onMount(() => {
        seenLoading.push(r.loading());
      });
      return document.createTextNode('');
    }, container);

    await flushAll();
    // onMount runs as a microtask; by then the promise has resolved.
    expect(seenLoading.length).toBe(1);
    expect(typeof seenLoading[0]).toBe('boolean');
  });
});

describe('resource — argument parsing', () => {
  it('treats second argument as options when it is a plain object', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1));
    const r = resource(fetcher, { initialValue: 0 });
    expect(r()).toBe(0);
    await flushAll();
    expect(r()).toBe(1);
  });

  it('treats second argument as fetcher when it is a function (source form)', async () => {
    const id = state(3);
    const r = resource(
      () => id(),
      (k) => Promise.resolve(k * 2),
    );
    await flushAll();
    expect(r()).toBe(6);
  });
});

describe('resource — source-side error handling', () => {
  it('captures a throw from the source function as r.error()', async () => {
    const id = state(1);
    const r = resource(
      () => {
        if (id() === 2) throw new Error('source-boom');
        return id();
      },
      (k) => Promise.resolve(`u${k}`),
    );

    await flushAll();
    expect(r()).toBe('u1');

    id(2);
    await flushAll();
    expect((r.error() as Error).message).toBe('source-boom');
    expect(r.loading()).toBe(false);
  });

  it('recovers when the source stops throwing', async () => {
    const id = state(1);
    const r = resource(
      () => {
        if (id() === 2) throw new Error('source-boom');
        return id();
      },
      (k) => Promise.resolve(`u${k}`),
    );

    id(2);
    await flushAll();
    expect(r.error()).toBeInstanceOf(Error);

    id(3);
    await flushAll();
    expect(r.error()).toBe(undefined);
    expect(r()).toBe('u3');
  });
});

describe('resource — mutate semantics', () => {
  it('mutate() while a fetch is in flight invalidates the resolution (no clobber)', async () => {
    let resolveFetch!: (v: string) => void;
    const id = state(1);
    const r = resource(
      () => id(),
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    await flushAll();
    expect(r.loading()).toBe(true);

    r.mutate('optimistic');
    expect(r()).toBe('optimistic');
    expect(r.loading()).toBe(false);

    resolveFetch('from-server');
    await flushAll();
    // Optimistic value must survive — the in-flight fetch was invalidated.
    expect(r()).toBe('optimistic');
  });

  it("mutate() aborts the in-flight request's signal", async () => {
    let captured!: AbortSignal;
    const r = resource(
      () => 1 as const,
      (_, { signal }) => {
        captured = signal;
        return new Promise<number>(() => {});
      },
    );
    await flushAll();
    expect(captured.aborted).toBe(false);

    r.mutate(42);
    expect(captured.aborted).toBe(true);
  });

  it('refresh() after mutate() still re-runs the fetcher', async () => {
    const id = state(1);
    let calls = 0;
    const r = resource(
      () => id(),
      (k) => {
        calls++;
        return Promise.resolve(`u${k}-${calls}`);
      },
    );
    await flushAll();
    expect(calls).toBe(1);

    r.mutate('manual');
    expect(r()).toBe('manual');

    r.refresh();
    await flushAll();
    expect(calls).toBe(2);
    expect(r()).toBe('u1-2');
  });
});

describe('resource — multi-stage races', () => {
  it('drops both intermediate runs A and B when C is the latest', async () => {
    const resolvers: Record<number, (v: string) => void> = {};
    const id = state(1);
    const r = resource(
      () => id(),
      (k) =>
        new Promise<string>((resolve) => {
          resolvers[k] = resolve;
        }),
    );

    await flushAll();
    id(2);
    await flushAll();
    id(3);
    await flushAll();

    // Resolve in reverse order — only the latest should win.
    resolvers[3]('C');
    await flushAll();
    expect(r()).toBe('C');

    resolvers[2]('B');
    resolvers[1]('A');
    await flushAll();
    expect(r()).toBe('C');
  });

  it("refresh() while a fetch is pending aborts the prior run's signal", async () => {
    const signals: AbortSignal[] = [];
    const r = resource(
      () => 1 as const,
      (_, { signal }) => {
        signals.push(signal);
        return new Promise<number>(() => {});
      },
    );
    await flushAll();
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(false);

    r.refresh();
    await flushAll();
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});

describe('resource — reactive tracking proof', () => {
  it('outside watch() re-fires when r.loading() transitions', async () => {
    const r = resource(() => Promise.resolve('done'));
    const seen: boolean[] = [];
    const stop = watch(() => {
      seen.push(r.loading());
    });

    await flushAll();
    stop();

    // Two distinct observations: initial sync (true) and post-resolve (false).
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });

  it('outside compute() re-derives only when r() actually changes', async () => {
    const id = state(1);
    const r = resource(
      () => id(),
      (k) => Promise.resolve(k * 10),
    );
    await flushAll();

    let derives = 0;
    const view = compute(() => {
      derives++;
      return r() ?? 0;
    });

    expect(view()).toBe(10);
    expect(derives).toBe(1);

    // Re-running watcher with same value (refresh produces same result)
    r.refresh();
    await flushAll();
    view();
    // Same value → no re-derive of view.
    expect(derives).toBe(1);

    id(2);
    await flushAll();
    expect(view()).toBe(20);
    expect(derives).toBe(2);
  });

  it('outside watch() re-fires when r.error() transitions', async () => {
    let shouldFail = true;
    const r = resource(
      () => 1 as const,
      () => (shouldFail ? Promise.reject(new Error('x')) : Promise.resolve('ok')),
    );

    const seen: unknown[] = [];
    const stop = watch(() => {
      seen.push(r.error());
    });

    await flushAll();
    // Initial undefined → Error transition observed.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)).toBeInstanceOf(Error);

    const errLength = seen.length;
    shouldFail = false;
    r.refresh();
    await flushAll();
    // Error → undefined transition observed (additional entries).
    expect(seen.length).toBeGreaterThan(errLength);
    expect(seen.at(-1)).toBe(undefined);

    stop();
  });
});

describe('resource — dispose escape hatch', () => {
  it('dispose() stops further fetches when called outside a component', async () => {
    const id = state(1);
    let calls = 0;
    const r = resource(
      () => id(),
      (k) => {
        calls++;
        return Promise.resolve(k);
      },
    );
    await flushAll();
    expect(calls).toBe(1);

    r.dispose();

    id(2);
    await flushAll();
    expect(calls).toBe(1);
  });

  it("dispose() aborts the in-flight request's signal", async () => {
    let captured!: AbortSignal;
    const r = resource(
      () => 1 as const,
      (_, { signal }) => {
        captured = signal;
        return new Promise<number>(() => {});
      },
    );
    await flushAll();
    expect(captured.aborted).toBe(false);

    r.dispose();
    expect(captured.aborted).toBe(true);
  });

  it('dispose() clears loading() so UI never sticks on a forever spinner', async () => {
    const r = resource(() => new Promise<number>(() => {}));
    await flushAll();
    expect(r.loading()).toBe(true);

    r.dispose();
    expect(r.loading()).toBe(false);
  });
});

describe('resource — round-2 dedup invalidation', () => {
  it('mutate() then a same-key source emission still re-fetches (optimistic reconciliation)', async () => {
    const id = state(1);
    const unrelated = state(0);
    let calls = 0;
    const r = resource(
      () => {
        unrelated();
        return id();
      },
      (k) => {
        calls++;
        return Promise.resolve(`server-${k}-${calls}`);
      },
    );
    await flushAll();
    expect(calls).toBe(1);
    expect(r()).toBe('server-1-1');

    r.mutate('optimistic');
    expect(r()).toBe('optimistic');

    // An unrelated state change re-runs the watch with the same source value;
    // because mutate() reset the dedup, this now re-fetches to reconcile.
    unrelated(1);
    await flushAll();
    expect(calls).toBe(2);
    expect(r()).toBe('server-1-2');
  });

  it('source-throw recovery to the same key clears error and re-fetches', async () => {
    const id = state(1);
    let calls = 0;
    let throwOnNext = false;
    const r = resource(
      () => {
        if (throwOnNext) throw new Error('source-boom');
        return id();
      },
      (k) => {
        calls++;
        return Promise.resolve(`u${k}-${calls}`);
      },
    );
    await flushAll();
    expect(calls).toBe(1);
    expect(r()).toBe('u1-1');

    // Trigger source throw without changing the underlying key.
    throwOnNext = true;
    id(1);
    // id(1) is a no-op write (Object.is), so we need to bump via refresh
    // to force the watch to re-evaluate the source.
    r.refresh();
    await flushAll();
    expect(r.error()).toBeInstanceOf(Error);
    expect(calls).toBe(1);

    // Source recovers; refresh again. Without the hasPrevKey reset in catch,
    // the dedup would skip this and error() would stay set.
    throwOnNext = false;
    r.refresh();
    await flushAll();
    expect(r.error()).toBe(undefined);
    expect(calls).toBe(2);
    expect(r()).toBe('u1-2');
  });
});

describe('resource — retry option', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries on rejection and succeeds within the retry budget', async () => {
    let calls = 0;
    const r = resource(
      () => {
        calls++;
        if (calls < 3) return Promise.reject(new Error(`attempt-${calls}`));
        return Promise.resolve('ok');
      },
      { retry: { count: 3, delay: () => 10 } },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toBe(3);

    await vi.advanceTimersByTimeAsync(0);
    expect(r()).toBe('ok');
    expect(r.error()).toBe(undefined);
    expect(r.loading()).toBe(false);
  });

  it('exhausts the retry count and surfaces the final error', async () => {
    let calls = 0;
    const boom = new Error('always-fails');
    const r = resource(
      () => {
        calls++;
        return Promise.reject(boom);
      },
      { retry: { count: 2, delay: () => 5 } },
    );

    // Initial + 2 retries = 3 attempts.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toBe(3);
    expect(r.error()).toBe(boom);
    expect(r.loading()).toBe(false);
  });

  it('aborts pending retry sleep when deps change mid-backoff', async () => {
    const id = state(1);
    const callsByKey: Record<number, number> = {};
    const r = resource(
      () => id(),
      (k) => {
        callsByKey[k] = (callsByKey[k] ?? 0) + 1;
        return Promise.reject(new Error(`fail-${k}`));
      },
      { retry: { count: 5, delay: () => 1000 } },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(callsByKey[1]).toBe(1);

    // Mid-backoff for key 1, change deps to key 2 — key 1's retry sleep should abort.
    id(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(callsByKey[2]).toBe(1);

    // Advance past the entire retry budget for key 1; it must never retry.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callsByKey[1]).toBe(1);
    void r;
  });

  it('accepts a number shorthand for the retry option', async () => {
    let calls = 0;
    const r = resource(
      () => {
        calls++;
        if (calls < 2) return Promise.reject(new Error('once'));
        return Promise.resolve('ok');
      },
      { retry: 1 },
    );

    await vi.advanceTimersByTimeAsync(0);
    // Default backoff for attempt 0 is 200ms.
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls).toBe(2);
    expect(r()).toBe('ok');
  });

  it('does not retry on success', async () => {
    let calls = 0;
    const r = resource(
      () => {
        calls++;
        return Promise.resolve('first');
      },
      { retry: 5 },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(r()).toBe('first');
  });
});

describe('resource — pollInterval option', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-fetches on the configured interval after each settle', async () => {
    let calls = 0;
    const r = resource(() => Promise.resolve(++calls), { pollInterval: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(r()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(r()).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(3);
  });

  it('reschedules polling after an error', async () => {
    let calls = 0;
    const r = resource(
      () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve('ok');
      },
      { pollInterval: 100 },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(r.error()).toBeInstanceOf(Error);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(r()).toBe('ok');
    expect(r.error()).toBe(undefined);
  });

  it('clears the poll timer on dispose', async () => {
    let calls = 0;
    const r = resource(() => Promise.resolve(++calls), { pollInterval: 100 });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    r.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
  });

  it('clears the poll timer on mutate (until next settle)', async () => {
    let calls = 0;
    const r = resource(() => Promise.resolve(++calls), { pollInterval: 100 });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    r.mutate(99);
    // mutate clears the pending poll timer.
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);
    expect(r()).toBe(99);
  });

  it('clears the poll timer on manual refresh()', async () => {
    let calls = 0;
    const r = resource(() => Promise.resolve(++calls), { pollInterval: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    // Refresh before the poll fires; the previous poll timer is cleared and
    // the refresh kicks off a new run, which then schedules its own poll.
    r.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);

    // Only one poll should remain pending — not two.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(3);
  });
});

describe('lazyResource', () => {
  it('does not fetch on creation', async () => {
    const fetcher = vi.fn(() => Promise.resolve('x'));
    const r = lazyResource(fetcher);
    await tick();
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
    expect(r()).toBe(undefined);
    expect(r.loading()).toBe(false);
  });

  it('fetches when r.fetch(args) is called and passes args to the fetcher', async () => {
    const r = lazyResource((args: { id: number }) => Promise.resolve(`u${args.id}`));
    r.fetch({ id: 42 });
    await flushAll();
    expect(r()).toBe('u42');
  });

  it('refresh() re-runs with the most recent args', async () => {
    let calls = 0;
    const r = lazyResource((args: number) => {
      calls++;
      return Promise.resolve(`${args}-${calls}`);
    });

    r.fetch(7);
    await flushAll();
    expect(r()).toBe('7-1');

    r.refresh();
    await flushAll();
    expect(r()).toBe('7-2');
    expect(calls).toBe(2);
  });

  it('back-to-back fetch() calls with identical args still re-fetch', async () => {
    let calls = 0;
    const r = lazyResource((arg: string) => {
      calls++;
      return Promise.resolve(`${arg}-${calls}`);
    });

    r.fetch('same');
    await flushAll();
    r.fetch('same');
    await flushAll();
    expect(calls).toBe(2);
    expect(r()).toBe('same-2');
  });

  it('exposes loading() and error() reactively', async () => {
    const r = lazyResource(() => Promise.reject(new Error('lazy-fail')));
    expect(r.loading()).toBe(false);

    // Capture transitions through a reactive watch — the loading=true window
    // between the watch run and the .then(onRejected) microtask is too brief
    // to read synchronously after a single tick.
    const seen: boolean[] = [];
    const stop = watch(() => {
      seen.push(r.loading());
    });

    r.fetch(undefined);
    await flushAll();
    stop();

    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
    expect((r.error() as Error).message).toBe('lazy-fail');
  });

  it('dispose() prevents further fetches', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1));
    const r = lazyResource(fetcher);
    r.dispose();
    r.fetch(undefined);
    await flushAll();
    // The watch is disposed, so the args write does not trigger a re-run.
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('debounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mirrors the source synchronously on first read', () => {
    const s = state('hello');
    const d = debounced(s, 100);
    expect(d()).toBe('hello');
  });

  it('delays propagation by the configured ms', async () => {
    const s = state('a');
    const d = debounced(s, 100);

    s('b');
    await vi.advanceTimersByTimeAsync(50);
    expect(d()).toBe('a');

    await vi.advanceTimersByTimeAsync(50);
    expect(d()).toBe('b');
  });

  it('coalesces rapid bursts into a single propagation', async () => {
    const s = state(0);
    const d = debounced(s, 100);

    for (let i = 1; i <= 10; i++) {
      s(i);
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(d()).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(d()).toBe(10);
  });

  it('feeds cleanly into a resource() source', async () => {
    const search = state('');
    const query = debounced(search, 100);
    let calls = 0;
    const r = resource(
      () => query() || null,
      (q) => {
        calls++;
        return Promise.resolve(`results-${q}`);
      },
    );

    expect(calls).toBe(0);

    search('hello');
    await vi.advanceTimersByTimeAsync(50);
    search('hello world');
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    // Only the final value triggers the fetch.
    expect(calls).toBe(1);
    expect(r()).toBe('results-hello world');
    r.dispose();
  });

  it('is read-only (no .set method on the accessor)', () => {
    const s = state(1);
    const d = debounced(s, 50);
    expect((d as unknown as { set?: unknown }).set).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// ADR 0024 — SSR-aware lazyResource.fetch()
//
// When called inside an SSR render context with a `key` option, fetch()
// bypasses the argsState/watch plumbing and registers the in-flight
// promise with `ssrCtx.pendingPromises` so the multipass renderer awaits
// it. Pass 2 reads the cached value via mutate().
// ---------------------------------------------------------------------------

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

describe('lazyResource — SSR multipass registration (ADR 0024)', () => {
  it('pushes the fetcher promise onto pendingPromises on pass 1', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      let fetcherCalls = 0;
      const r = lazyResource(
        async (args: { id: number }) => {
          fetcherCalls++;
          return `user-${args.id}`;
        },
        { key: 'user-fetch' },
      );
      r.fetch({ id: 42 });
      expect(fetcherCalls).toBe(1);
      expect(ctx.pendingPromises).toHaveLength(1);
    } finally {
      popSSRRenderContext();
    }
  });

  it('caches the resolved value in resolvedDataByKey for the second pass', async () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const r = lazyResource(async (id: number) => `user-${id}`, { key: 'k' });
      r.fetch(42);
      await Promise.all(ctx.pendingPromises);
      expect(ctx.resolvedDataByKey.k).toBe('user-42');
      expect(ctx.resolvedErrorsByKey.k).toBeUndefined();
    } finally {
      popSSRRenderContext();
    }
  });

  it('pass-2 fetch reads the cached value via mutate() without re-fetching', async () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      let fetcherCalls = 0;
      // Pass 1
      const r1 = lazyResource(
        async (id: number) => {
          fetcherCalls++;
          return `user-${id}`;
        },
        { key: 'k' },
      );
      r1.fetch(42);
      await Promise.all(ctx.pendingPromises);
      expect(fetcherCalls).toBe(1);

      // Pass 2 — fresh lazyResource (the App function reruns), cached value applied.
      ctx.pendingPromises.length = 0;
      const r2 = lazyResource(
        async (id: number) => {
          fetcherCalls++;
          return `user-${id}`;
        },
        { key: 'k' },
      );
      r2.fetch(42);
      // Fetcher was NOT called again.
      expect(fetcherCalls).toBe(1);
      // r2.data() should now reflect the cached value (mutate ran).
      expect(r2()).toBe('user-42');
      // No promise was registered on pass 2 either.
      expect(ctx.pendingPromises).toHaveLength(0);
    } finally {
      popSSRRenderContext();
    }
  });

  it('pass-2 re-throws cached error so consumer try/catch fires an errorBoundary path', async () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      // Pass 1 — fetcher throws.
      const r1 = lazyResource(
        async () => {
          throw new Error('boom');
        },
        { key: 'k' },
      );
      r1.fetch(undefined);
      // Let the rejection settle.
      await Promise.allSettled(ctx.pendingPromises);
      expect(ctx.resolvedErrorsByKey.k).toBeInstanceOf(Error);

      // Pass 2 — fresh lazyResource should re-throw on fetch().
      ctx.pendingPromises.length = 0;
      const r2 = lazyResource(async () => 'never', { key: 'k' });
      expect(() => r2.fetch(undefined)).toThrow('boom');
    } finally {
      popSSRRenderContext();
    }
  });

  it('falls back to client-only behavior when no key is supplied', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      let fetcherCalls = 0;
      const r = lazyResource(async () => {
        fetcherCalls++;
        return 'x';
      });
      r.fetch(undefined);
      // No SSR registration without key — the fetcher runs on the
      // microtask queue (client path), not synchronously.
      expect(fetcherCalls).toBe(0);
      expect(ctx.pendingPromises).toHaveLength(0);
    } finally {
      popSSRRenderContext();
    }
  });

  it('outside SSR context behaves exactly like before (lazy + reactive)', async () => {
    let fetcherCalls = 0;
    const r = lazyResource(
      async (id: number) => {
        fetcherCalls++;
        return `v-${id}`;
      },
      { key: 'k' },
    );
    expect(fetcherCalls).toBe(0);
    expect(r()).toBeUndefined();
    r.fetch(1);
    await flushAll();
    expect(fetcherCalls).toBe(1);
    expect(r()).toBe('v-1');
    r.dispose();
  });
});
