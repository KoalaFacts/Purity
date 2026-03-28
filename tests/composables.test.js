import { describe, expect, it } from 'vitest';
import { useRef, useStore } from '../src/composables.ts';
import { compute, state } from '../src/signals.ts';

describe('useStore', () => {
  it('creates a singleton store', () => {
    const useCounter = useStore(() => {
      const count = state(0);
      const increment = () => count((v) => v + 1);
      return { count, increment };
    });

    const a = useCounter();
    const b = useCounter();
    expect(a).toBe(b);
  });

  it('store state is shared', () => {
    const useCounter = useStore(() => {
      const count = state(0);
      return { count };
    });

    const a = useCounter();
    a.count(5);

    const b = useCounter();
    expect(b.count()).toBe(5);
  });

  it('store can have computed values', () => {
    const useCounter = useStore(() => {
      const count = state(10);
      const doubled = compute(() => count() * 2);
      return { count, doubled };
    });

    const store = useCounter();
    expect(store.doubled()).toBe(20);
    store.count(5);
    expect(store.doubled()).toBe(10);
  });
});

describe('useRef', () => {
  it('holds a mutable value', () => {
    const ref = useRef(0);
    expect(ref.current).toBe(0);
    ref.current = 42;
    expect(ref.current).toBe(42);
  });

  it('holds null by default for DOM refs', () => {
    const ref = useRef(null);
    expect(ref.current).toBeNull();
  });
});
