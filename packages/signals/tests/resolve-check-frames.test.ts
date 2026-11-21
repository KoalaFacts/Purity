import { describe, expect, it } from 'vite-plus/test';
import { compute, state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

// CQ-12: resolveCheck keeps the frame being walked in locals and suspends
// ancestors only on descent. These cases pin what the suspended frames must
// restore: the parent node, its source list, its version snapshot and the
// source index it stopped at.
describe('resolveCheck suspended frames', () => {
  it('resumes a parent at the source it descended from, not at the start', () => {
    const a = state(1);
    const b = state(10);
    let midRuns = 0;
    const mid = compute(() => {
      midRuns++;
      return a() % 2;
    });
    let topRuns = 0;
    // Sources in order: b (state), mid (computed, CHECK after a write), b again.
    const top = compute(() => {
      topRuns++;
      return b() + mid() + b();
    });
    expect(top()).toBe(21);
    expect([midRuns, topRuns]).toEqual([1, 1]);

    // a 1 → 3: mid recomputes to the same value, so top must settle CLEAN.
    a(3);
    expect(top()).toBe(21);
    expect([midRuns, topRuns]).toEqual([2, 1]);

    // a 3 → 4: mid changes, so top must recompute.
    a(4);
    expect(top()).toBe(20);
    expect([midRuns, topRuns]).toEqual([3, 2]);
  });

  it('restores each level of a nested descent with its own sources and versions', () => {
    const leaf = state(0);
    const other = state(100);
    const runs = { l1: 0, l2: 0, l3: 0 };
    const l1 = compute(() => {
      runs.l1++;
      return leaf() > 5 ? 1 : 0;
    });
    const l2 = compute(() => {
      runs.l2++;
      return other() + l1();
    });
    const l3 = compute(() => {
      runs.l3++;
      return l2() * 2 + other();
    });
    expect(l3()).toBe(300);

    leaf(1); // l1 unchanged → l2, l3 settle CLEAN without recomputing
    expect(l3()).toBe(300);
    expect(runs).toEqual({ l1: 2, l2: 1, l3: 1 });

    leaf(9); // l1 changes → l2 and l3 recompute
    expect(l3()).toBe(302);
    expect(runs).toEqual({ l1: 3, l2: 2, l3: 2 });

    other(0); // only the state sources change
    expect(l3()).toBe(2);
    expect(runs).toEqual({ l1: 3, l2: 3, l3: 3 });
  });

  it('resolves two CHECK siblings under one parent, the second after the first returns', () => {
    const s = state(0);
    const left = compute(() => s() & 1);
    const right = compute(() => s() & 2);
    let runs = 0;
    const parent = compute(() => {
      runs++;
      return left() + right();
    });
    expect(parent()).toBe(0);
    s(4); // both siblings unchanged
    expect(parent()).toBe(0);
    expect(runs).toBe(1);
    s(6); // first sibling unchanged, second changed
    expect(parent()).toBe(2);
    expect(runs).toBe(2);
  });

  it('a computed read during another resolution resolves its own graph independently', async () => {
    const a = state(0);
    const b = state(0);
    const bChain = compute(() => compute(() => b() + 1)());
    // aTop reads bChain inside its body: resolving aTop runs user code that
    // starts a second resolveCheck while the first one is mid-walk.
    const aMid = compute(() => a() * 2);
    const aTop = compute(() => aMid() + bChain());
    const seen: number[] = [];
    watch(() => seen.push(aTop()));
    await tick();
    a(1);
    b(1);
    await tick();
    a(2);
    await tick();
    expect(seen).toEqual([1, 4, 6]);
  });

  it('walks a 20,000-deep CHECK chain without growing the call stack', () => {
    const root = state(0);
    let node = compute(() => root());
    for (let i = 0; i < 20_000; i++) {
      const prev = node;
      node = compute(() => prev() + 1);
      // Read as it grows so the first evaluation of each link is shallow;
      // the deep walk under test is the CHECK resolution after the write.
      node();
    }
    expect(node()).toBe(20_000);
    root(1);
    expect(node()).toBe(20_001);
  });
});
