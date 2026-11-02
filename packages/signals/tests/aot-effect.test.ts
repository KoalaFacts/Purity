import { describe, expect, it } from 'vite-plus/test';
import * as signals from '../src/index.ts';

// This is the single-callback effect used by generated client templates.
const effect = (
  signals as unknown as {
    watchEffectInternal: (fn: () => undefined | (() => void)) => () => void;
  }
).watchEffectInternal;

describe('internal template effect', () => {
  it('supports computed values created after an effect has already run', async () => {
    const count = signals.state(1);
    const select = signals.state(false);
    let derived: (() => number) | undefined;
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(select() ? derived!() : count());
      return undefined;
    });
    const { compute } = await import('../src/index.ts');
    derived = compute(() => count() * 2);
    select(true);
    await Promise.resolve();
    count(3);
    await Promise.resolve();
    expect(seen).toEqual([1, 2, 6]);
    stop();
  });

  it('shares state, cleanup, and scope disposal with public watch', async () => {
    expect(typeof effect).toBe('function');
    const count = signals.state(0);
    const calls: string[] = [];
    const scope: signals.Scope = {};
    signals.pushContext(scope);
    try {
      effect(() => {
        const value = count();
        calls.push(`effect:${value}`);
        return () => calls.push(`cleanup:${value}`);
      });
    } finally {
      signals.popContext();
    }
    const stop = signals.watch(count, (value, previous) => {
      calls.push(`watch:${previous}->${value}`);
      return undefined;
    });
    expect(calls).toEqual(['effect:0']);
    count(1);
    await Promise.resolve();
    expect(calls).toEqual(['effect:0', 'cleanup:0', 'effect:1', 'watch:0->1']);
    signals.disposeScope(scope);
    count(2);
    await Promise.resolve();
    expect(calls).toEqual([
      'effect:0',
      'cleanup:0',
      'effect:1',
      'watch:0->1',
      'cleanup:1',
      'watch:1->2',
    ]);
    stop();
  });

  it('propagates an initial throw and detaches its observed sources', async () => {
    expect(typeof effect).toBe('function');
    const count = signals.state(0);
    const error = new Error('effect failed');
    let runs = 0;
    expect(() =>
      effect(() => {
        count();
        runs++;
        throw error;
      }),
    ).toThrow(error);
    count(1);
    await Promise.resolve();
    expect(runs).toBe(1);
  });

  it('routes later errors through the component owner and stays subscribed', async () => {
    expect(typeof effect).toBe('function');
    const count = signals.state(0);
    const owner = new signals.ComponentContext();
    const seen: unknown[] = [];
    const ownerInHandler: unknown[] = [];
    let cleanups = 0;
    owner.errorHandlers = [
      (error) => {
        seen.push(error);
        ownerInHandler.push(signals.getCurrentComponent());
      },
    ];
    signals.pushContext(owner);
    let stop: () => void;
    try {
      stop = effect(() => {
        const value = count();
        if (value) throw new Error(`failure:${value}`);
        return () => {
          cleanups++;
        };
      });
    } finally {
      signals.popContext();
    }
    count(1);
    await Promise.resolve();
    count(2);
    await Promise.resolve();
    expect(seen.map((error) => (error as Error).message)).toEqual(['failure:1', 'failure:2']);
    expect(ownerInHandler).toEqual([owner, owner]);
    expect(cleanups).toBe(1);
    stop();
  });
});
