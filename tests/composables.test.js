import { describe, expect, it } from 'vitest';
import { store } from '../src/composables.ts';
import { compute, state } from '../src/signals.ts';

describe('store', () => {
  it('creates a singleton store', () => {
    const useCounter = store(() => {
      const count = state(0);
      const increment = () => count((v) => v + 1);
      return { count, increment };
    });

    const a = useCounter();
    const b = useCounter();
    expect(a).toBe(b);
  });

  it('store state is shared', () => {
    const useCounter = store(() => {
      const count = state(0);
      return { count };
    });

    const a = useCounter();
    a.count(5);

    const b = useCounter();
    expect(b.count()).toBe(5);
  });

  it('store can have computed values', () => {
    const useCounter = store(() => {
      const count = state(10);
      const doubled = compute(() => count() * 2);
      return { count, doubled };
    });

    const s = useCounter();
    expect(s.doubled()).toBe(20);
    s.count(5);
    expect(s.doubled()).toBe(10);
  });
});
