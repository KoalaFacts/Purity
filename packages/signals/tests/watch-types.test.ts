import { describe, expect, it } from 'vite-plus/test';
import { state, watch } from '../src/index.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// CQ-09: tests are type-checked in CI (`tsconfig.tests.json`), so these cases
// fail the type gate if `watch()` stops accepting expression bodies again.
// `watch(() => console.log(count()))` is the README's first example; it did
// not compile while the callback type was `() => undefined | Dispose`.
describe('watch() callback return types', () => {
  it('accepts an expression body that returns void, a number or another value', async () => {
    const count = state(0);
    const seen: number[] = [];
    const log = (value: number): void => {
      seen.push(value);
    };
    const stopVoid = watch(() => log(count()));
    const stopNumber = watch(() => seen.push(count() * 10));
    const stopSource = watch(count, (value) => seen.push(value * 100));
    const stopTuple = watch([count], ([value]) => seen.push(value * 1000));

    count(1);
    await tick();
    expect(seen).toEqual([0, 0, 1, 10, 100, 1000]);

    stopVoid();
    stopNumber();
    stopSource();
    stopTuple();
  });

  it('still runs a returned function as cleanup', async () => {
    const count = state(0);
    const cleanups: number[] = [];
    const stop = watch(() => {
      const value = count();
      return () => cleanups.push(value);
    });
    count(1);
    await tick();
    stop();
    expect(cleanups).toEqual([0, 1]);
  });
});
