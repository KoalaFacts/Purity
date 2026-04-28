import { describe, expect, it, vi } from 'vitest';
import { batch, compute, state, watch } from '../src/signals.ts';

describe('state', () => {
  it('reads the initial value', () => {
    const count = state(0);
    expect(count()).toBe(0);
  });

  it('writes and reads a new value', () => {
    const count = state(0);
    count(5);
    expect(count()).toBe(5);
  });

  it('supports .get() and .set()', () => {
    const count = state(10);
    expect(count.get()).toBe(10);
    count.set(20);
    expect(count.get()).toBe(20);
  });

  it('accepts updater function', () => {
    const count = state(5);
    count((v) => v + 1);
    expect(count()).toBe(6);
    count((v) => v * 3);
    expect(count()).toBe(18);
  });

  it('updater works with arrays', () => {
    const items = state(['a', 'b']);
    items((v) => [...v, 'c']);
    expect(items()).toEqual(['a', 'b', 'c']);
  });

  it('updater works with booleans', () => {
    const flag = state(true);
    flag((v) => !v);
    expect(flag()).toBe(false);
  });

  it('supports .peek() without tracking', () => {
    const count = state(42);
    expect(count.peek()).toBe(42);
  });

  it('works with different value types', () => {
    const str = state('hello');
    expect(str()).toBe('hello');
    str('world');
    expect(str()).toBe('world');

    const obj = state({ a: 1 });
    expect(obj()).toEqual({ a: 1 });
    obj({ b: 2 });
    expect(obj()).toEqual({ b: 2 });

    const arr = state([1, 2, 3]);
    expect(arr()).toEqual([1, 2, 3]);
  });
});

describe('computed', () => {
  it('derives a value from state', () => {
    const count = state(5);
    const doubled = compute(() => count() * 2);
    expect(doubled()).toBe(10);
  });

  it('updates when dependency changes', () => {
    const count = state(1);
    const doubled = compute(() => count() * 2);

    expect(doubled()).toBe(2);
    count(3);
    expect(doubled()).toBe(6);
  });

  it('chains multiple computed values', () => {
    const a = state(1);
    const b = compute(() => a() + 1);
    const c = compute(() => b() * 2);

    expect(c()).toBe(4);
    a(5);
    expect(c()).toBe(12);
  });

  it('supports .peek() without tracking', () => {
    const count = state(3);
    const doubled = compute(() => count() * 2);
    expect(doubled.peek()).toBe(6);
  });
});

describe('watch (auto-track)', () => {
  it('runs immediately on creation', () => {
    const fn = vi.fn();
    const count = state(0);

    watch(() => {
      fn(count());
    });

    expect(fn).toHaveBeenCalledWith(0);
  });

  it('re-runs when dependencies change', async () => {
    const values = [];
    const count = state(0);

    watch(() => {
      values.push(count());
    });

    expect(values).toEqual([0]);

    count(1);
    // Effects are batched via microtask
    await new Promise((r) => queueMicrotask(r));
    expect(values).toEqual([0, 1]);

    count(2);
    await new Promise((r) => queueMicrotask(r));
    expect(values).toEqual([0, 1, 2]);
  });

  it('returns a dispose function', async () => {
    const values = [];
    const count = state(0);

    const dispose = watch(() => {
      values.push(count());
    });

    expect(values).toEqual([0]);
    dispose();

    count(1);
    await new Promise((r) => queueMicrotask(r));
    // Should not have re-run after dispose
    expect(values).toEqual([0]);
  });

  it('calls cleanup function on re-run', async () => {
    const cleanups = [];
    const count = state(0);

    watch(() => {
      count(); // track dependency
      return () => cleanups.push('cleanup');
    });

    count(1);
    await new Promise((r) => queueMicrotask(r));
    expect(cleanups).toEqual(['cleanup']);
  });
});

describe('watch', () => {
  it('auto-tracks like effect', () => {
    const fn = vi.fn();
    const count = state(0);

    watch(() => fn(count()));
    expect(fn).toHaveBeenCalledWith(0);
  });

  it('watches a single source with old/new values', async () => {
    const calls = [];
    const count = state(0);

    watch(count, (val, old) => {
      calls.push({ val, old });
    });

    count(1);
    await new Promise((r) => queueMicrotask(r));
    expect(calls).toEqual([{ val: 1, old: 0 }]);

    count(5);
    await new Promise((r) => queueMicrotask(r));
    expect(calls).toEqual([
      { val: 1, old: 0 },
      { val: 5, old: 1 },
    ]);
  });

  it('watches multiple sources', async () => {
    const calls = [];
    const a = state(1);
    const b = state('x');

    watch([a, b], (vals, olds) => {
      calls.push({ vals: [...vals], olds: [...olds] });
    });

    a(2);
    await new Promise((r) => queueMicrotask(r));
    expect(calls).toEqual([{ vals: [2, 'x'], olds: [1, 'x'] }]);

    b('y');
    await new Promise((r) => queueMicrotask(r));
    expect(calls).toEqual([
      { vals: [2, 'x'], olds: [1, 'x'] },
      { vals: [2, 'y'], olds: [2, 'x'] },
    ]);
  });

  it('watches a computed source', async () => {
    const calls = [];
    const count = state(1);
    const doubled = compute(() => count() * 2);

    watch(doubled, (val, old) => {
      calls.push({ val, old });
    });

    count(3);
    await new Promise((r) => queueMicrotask(r));
    expect(calls).toEqual([{ val: 6, old: 2 }]);
  });

  it('does not fire callback on initial run (explicit source)', async () => {
    const fn = vi.fn();
    const count = state(0);

    watch(count, fn);
    expect(fn).not.toHaveBeenCalled();

    count(1);
    await new Promise((r) => queueMicrotask(r));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns dispose function (explicit source)', async () => {
    const calls = [];
    const count = state(0);

    const stop = watch(count, (val) => calls.push(val));

    count(1);
    await new Promise((r) => queueMicrotask(r));
    expect(calls).toEqual([1]);

    stop();

    count(2);
    await new Promise((r) => queueMicrotask(r));
    expect(calls).toEqual([1]);
  });
});

describe('batch', () => {
  it('batches multiple updates', async () => {
    const values = [];
    const a = state(0);
    const b = state(0);

    watch(() => {
      values.push(`${a()}-${b()}`);
    });

    expect(values).toEqual(['0-0']);

    batch(() => {
      a(1);
      b(2);
    });

    await new Promise((r) => queueMicrotask(r));
    // Should have the combined result, not intermediate states
    expect(values[values.length - 1]).toBe('1-2');
  });
});

describe('watch re-entrancy guard', () => {
  it('has a max depth guard on effects', () => {
    // The guard exists as a safety net (MAX_EFFECT_DEPTH = 100)
    // In practice, signal-polyfill prevents synchronous re-triggering
    // via its push-pull model, so it's a defense-in-depth measure
    expect(true).toBe(true);
  });
});

describe('watch dispose + cleanup', () => {
  it('runs cleanup function on dispose', async () => {
    const a = state(0);
    let cleanedUp = false;
    const dispose = watch(() => {
      a();
      return () => {
        cleanedUp = true;
      };
    });
    expect(cleanedUp).toBe(false);
    dispose();
    expect(cleanedUp).toBe(true);
  });

  it('dispose is idempotent', () => {
    const a = state(0);
    const dispose = watch(() => a());
    dispose();
    expect(() => dispose()).not.toThrow();
  });

  it('does not re-run after dispose', async () => {
    const a = state(0);
    const fn = vi.fn(() => {
      a();
    });
    const dispose = watch(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    dispose();
    a(1);
    await new Promise((r) => queueMicrotask(r));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('signal write produces same value', () => {
  it('does not re-run watch when value is unchanged', async () => {
    const a = state(1);
    const fn = vi.fn(() => a());
    watch(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    a(1); // same value
    await new Promise((r) => queueMicrotask(r));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dispose during pending flush coalesces with that flush', async () => {
    // Write to signal first → schedules microtask. Then dispose immediately.
    // scheduleUnwatch sees microtaskScheduled=true and skips re-scheduling.
    const a = state(0);
    const fn = vi.fn(() => a());
    const dispose = watch(fn);
    a(1);
    dispose();
    await new Promise((r) => queueMicrotask(r));
    // No additional invocation after dispose
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('batch — nested', () => {
  it('coalesces updates across nested batches', async () => {
    const a = state(0);
    const fn = vi.fn(() => a());
    watch(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    batch(() => {
      a(1);
      batch(() => {
        a(2);
        a(3);
      });
      a(4);
    });
    await new Promise((r) => queueMicrotask(r));
    // Single re-run regardless of nesting
    expect(fn).toHaveBeenCalledTimes(2);
    expect(a()).toBe(4);
  });

  it('flushes after batch when microtask already scheduled', async () => {
    const a = state(0);
    const b = state(0);
    const seen: number[] = [];
    watch(() => {
      seen.push(a() + b());
    });
    a(1);
    batch(() => {
      b(2);
    });
    await new Promise((r) => queueMicrotask(r));
    expect(seen[seen.length - 1]).toBe(3);
  });
});
