// @vitest-environment jsdom
// SV2-015 — shared compute/watch allocation must keep their different lifetimes.
import { describe, expect, it } from 'vite-plus/test';

import { popContext, pushContext, type Scope } from '../src/scope.ts';
import { compute, disposeScope, state, watch, type ComputedAccessor } from '../src/signals.ts';

const tick = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

describe('computed and effect node initialization', () => {
  it('keeps computes lazy and effects eager after sharing the node shape', async () => {
    const source = state(1);
    let derivations = 0;
    const memo = compute(() => {
      derivations++;
      return source() * 2;
    });
    expect(derivations).toBe(0);

    const seen: number[] = [];
    const stop = watch(() => {
      seen.push(memo());
    });
    expect(seen).toEqual([2]);
    expect(derivations).toBe(1);

    source(2);
    await tick();
    expect(seen).toEqual([2, 4]);
    expect(derivations).toBe(2);

    stop();
    source(3);
    await tick();
    expect(seen).toEqual([2, 4]);
    expect(memo()).toBe(6);
    expect(derivations).toBe(3);
  });

  it('releases both node types with their owner and freezes disposed computed snapshots', async () => {
    const source = state(0);
    const scope: Scope = { disposers: null };
    let memo!: ComputedAccessor<number>;
    const seen: number[] = [];
    let cleanups = 0;

    pushContext(scope);
    try {
      memo = compute(() => source() + 1);
      watch(() => {
        seen.push(memo());
        return () => {
          cleanups++;
        };
      });
    } finally {
      popContext();
    }
    expect(seen).toEqual([1]);

    source(1);
    await tick();
    expect(seen).toEqual([1, 2]);
    expect(cleanups).toBe(1);

    disposeScope(scope);
    expect(cleanups).toBe(2);
    source(2);
    await tick();
    expect(seen).toEqual([1, 2]);
    expect(memo()).toBe(2);
  });
});
