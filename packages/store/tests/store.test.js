import { describe, expect, it } from 'vitest';
import { store } from '../src/index.ts';

describe('store', () => {
  it('creates a singleton store', () => {
    const useCounter = store(() => {
      let count = 0;
      return {
        get: () => count,
        increment: () => ++count,
      };
    });

    const a = useCounter();
    const b = useCounter();
    expect(a).toBe(b);
  });

  it('store state is shared', () => {
    const useCounter = store(() => {
      let count = 0;
      return {
        get: () => count,
        set: (v) => { count = v; },
      };
    });

    const a = useCounter();
    a.set(5);

    const b = useCounter();
    expect(b.get()).toBe(5);
  });

  it('lazily initializes', () => {
    let initialized = false;
    const useData = store(() => {
      initialized = true;
      return { value: 42 };
    });

    expect(initialized).toBe(false);
    useData();
    expect(initialized).toBe(true);
  });
});
