import { describe, expect, it } from 'vite-plus/test';
import { batch, compute, state, watch } from '../src/signals.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

// CQ-12: markCheck reuses one module-level stack. These cases write again
// while an earlier propagation's effects are flushing, and interleave two
// independent graphs, so a stack left non-empty or shared between calls
// would mark the wrong nodes or skip some.
describe('markCheck shared stack', () => {
  it('marks every branch of a wide, deep graph on consecutive writes', async () => {
    const root = state(0);
    const leaves: (() => number)[] = [];
    for (let b = 0; b < 50; b++) {
      let node = compute(() => root() + b);
      for (let d = 0; d < 20; d++) {
        const prev = node;
        node = compute(() => prev() + 1);
      }
      leaves.push(node);
    }
    const seen: number[] = [];
    const total = compute(() => leaves.reduce((sum, l) => sum + l(), 0));
    watch(() => seen.push(total()));
    await tick();
    root(1);
    await tick();
    root(2);
    await tick();
    // sum over b of (root + b + 20) = 50 * root + 1225 + 1000
    expect(seen).toEqual([2225, 2275, 2325]);
  });

  it('a write from inside an effect flush propagates through another graph', async () => {
    const a = state(0);
    const b = state(0);
    const a2 = compute(() => compute(() => a() * 2)());
    const bChain = compute(() => compute(() => b() + 100)());
    const log: string[] = [];
    watch(() => {
      const v = a2();
      if (v > 0) b(v); // write during flush reaches another computed chain
      log.push(`a:${v}`);
    });
    watch(() => log.push(`b:${bChain()}`));
    await tick();
    a(3);
    await tick();
    await tick();
    expect(log).toEqual(['a:0', 'b:100', 'a:6', 'b:106']);
  });

  it('batched writes to two roots mark both graphs', async () => {
    const x = state(1);
    const y = state(1);
    const xs = compute(() => x() * 10);
    const ys = compute(() => y() * 100);
    const sum = compute(() => xs() + ys());
    const seen: number[] = [];
    watch(() => seen.push(sum()));
    await tick();
    batch(() => {
      x(2);
      y(3);
    });
    await tick();
    expect(seen).toEqual([110, 320]);
  });
});
