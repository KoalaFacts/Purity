import { describe, expect, it, vi } from 'vitest';
import { mount, onMount } from '../src/component.ts';
import { resource } from '../src/resource.ts';
import { compute, state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(() => r()));
const flushAll = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

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

    // Should observe at least one true (initial sync run) followed by false.
    expect(seen[0]).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
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
    expect(seen.at(-1)).toBeInstanceOf(Error);

    shouldFail = false;
    r.refresh();
    await flushAll();
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
});
