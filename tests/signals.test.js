import { describe, it, expect, vi } from 'vitest';
import { state, computed, effect, batch } from '../src/signals.js';

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
    const doubled = computed(() => count() * 2);
    expect(doubled()).toBe(10);
  });

  it('updates when dependency changes', () => {
    const count = state(1);
    const doubled = computed(() => count() * 2);

    expect(doubled()).toBe(2);
    count(3);
    expect(doubled()).toBe(6);
  });

  it('chains multiple computed values', () => {
    const a = state(1);
    const b = computed(() => a() + 1);
    const c = computed(() => b() * 2);

    expect(c()).toBe(4);
    a(5);
    expect(c()).toBe(12);
  });

  it('supports .peek() without tracking', () => {
    const count = state(3);
    const doubled = computed(() => count() * 2);
    expect(doubled.peek()).toBe(6);
  });
});

describe('effect', () => {
  it('runs immediately on creation', () => {
    const fn = vi.fn();
    const count = state(0);

    effect(() => {
      fn(count());
    });

    expect(fn).toHaveBeenCalledWith(0);
  });

  it('re-runs when dependencies change', async () => {
    const values = [];
    const count = state(0);

    effect(() => {
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

    const dispose = effect(() => {
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

    effect(() => {
      count(); // track dependency
      return () => cleanups.push('cleanup');
    });

    count(1);
    await new Promise((r) => queueMicrotask(r));
    expect(cleanups).toEqual(['cleanup']);
  });
});

describe('batch', () => {
  it('batches multiple updates', async () => {
    const values = [];
    const a = state(0);
    const b = state(0);

    effect(() => {
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
