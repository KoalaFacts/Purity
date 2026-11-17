import { disposeScope, popContext, pushContext, state, watch } from '@purityjs/signals';
import type { Scope } from '@purityjs/signals';
import { describe, expect, it } from 'vitest';
import { transaction } from '../src/transaction.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('transaction()', () => {
  it('applies staged writes together when the work resolves', async () => {
    const a = state(0);
    const b = state(0);
    const seen: string[] = [];
    const stop = watch(() => {
      seen.push(`${a()}:${b()}`);
    });
    const gate = deferred();
    const done = transaction(async (tx) => {
      tx.set(a, 1);
      await gate.promise;
      tx.set(b, 1);
      return 'ok';
    });
    await tick();
    expect(a.peek()).toBe(0);
    gate.resolve();
    expect(await done).toBe('ok');
    await tick();
    expect(a.peek()).toBe(1);
    expect(b.peek()).toBe(1);
    expect(seen).toEqual(['0:0', '1:1']);
    stop();
  });

  it('discards staged writes and rejects when the work rejects', async () => {
    const a = state('base');
    const boom = new Error('boom');
    const done = transaction(async (tx) => {
      tx.set(a, 'staged');
      throw boom;
    });
    await expect(done).rejects.toBe(boom);
    expect(a.peek()).toBe('base');
  });

  it('rejects with a synchronous throw and leaves state alone', async () => {
    const a = state(1);
    await expect(
      transaction((tx) => {
        tx.optimistic(a, 2);
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    expect(a.peek()).toBe(1);
  });

  it('shows an optimistic value at once and replaces it with the committed value', async () => {
    const title = state('old');
    const seen: string[] = [];
    const stop = watch(() => {
      seen.push(title());
    });
    const gate = deferred<string>();
    const done = transaction(async (tx) => {
      tx.optimistic(title, 'draft');
      tx.set(title, await gate.promise);
    });
    expect(title.peek()).toBe('draft');
    gate.resolve('saved');
    await done;
    await tick();
    expect(title.peek()).toBe('saved');
    expect(seen).toEqual(['old', 'draft', 'saved']);
    stop();
  });

  it('rolls an optimistic value back exactly once on rejection', async () => {
    const count = state(0);
    const seen: number[] = [];
    const stop = watch(() => {
      seen.push(count());
    });
    const gate = deferred();
    const done = transaction(async (tx) => {
      tx.optimistic(count, 1);
      await gate.promise;
    });
    expect(count.peek()).toBe(1);
    gate.reject(new Error('no'));
    await expect(done).rejects.toThrow('no');
    await tick();
    expect(count.peek()).toBe(0);
    expect(seen).toEqual([0, 1, 0]);
    stop();
  });

  it('keeps the newest overlay visible until every overlapping transaction settles', async () => {
    const count = state(0);
    const g1 = deferred();
    const g2 = deferred();
    const t1 = transaction(async (tx) => {
      tx.optimistic(count, 1);
      await g1.promise;
    });
    const t2 = transaction(async (tx) => {
      tx.optimistic(count, 2);
      await g2.promise;
      tx.set(count, 20);
    });
    expect(count.peek()).toBe(2);
    g1.resolve();
    await t1;
    expect(count.peek()).toBe(2);
    g2.resolve();
    await t2;
    expect(count.peek()).toBe(20);
  });

  it('a commit under another live overlay updates the base, shown after that overlay settles', async () => {
    const count = state(0);
    const g1 = deferred();
    const g2 = deferred();
    const t1 = transaction(async (tx) => {
      tx.optimistic(count, 99);
      await g1.promise;
    });
    const t2 = transaction(async (tx) => {
      await g2.promise;
      tx.set(count, 5);
    });
    g2.resolve();
    await t2;
    expect(count.peek()).toBe(99);
    g1.reject(new Error('x'));
    await expect(t1).rejects.toThrow('x');
    expect(count.peek()).toBe(5);
  });

  it('adopts a direct write made while an overlay is shown', async () => {
    const count = state(0);
    const gate = deferred();
    const done = transaction(async (tx) => {
      tx.optimistic(count, 1);
      await gate.promise;
    });
    count.set(7);
    gate.resolve();
    await done;
    expect(count.peek()).toBe(7);
  });

  it('aborts on owner disposal: discards writes, removes overlays, ignores late settlement', async () => {
    const a = state('base');
    const gate = deferred();
    const scope: Scope = { disposers: null } as Scope;
    let signal!: AbortSignal;
    pushContext(scope);
    const done = transaction(async (tx) => {
      signal = tx.signal;
      tx.optimistic(a, 'tentative');
      tx.set(a, 'staged');
      await gate.promise;
      tx.set(a, 'late');
    });
    popContext();
    expect(a.peek()).toBe('tentative');
    disposeScope(scope);
    expect(signal.aborted).toBe(true);
    expect(a.peek()).toBe('base');
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    gate.resolve();
    await tick();
    await tick();
    expect(a.peek()).toBe('base');
  });

  it('releases its owner disposer once settled', async () => {
    const scope: Scope = { disposers: null } as Scope;
    pushContext(scope);
    const done = transaction(async () => {});
    popContext();
    expect(scope.disposers?.length).toBe(1);
    await done;
    expect(scope.disposers?.length).toBe(0);
    disposeScope(scope);
  });

  it('throws when set or optimistic is called after settlement', async () => {
    const a = state(0);
    let saved!: Parameters<Parameters<typeof transaction>[0]>[0];
    await transaction((tx) => {
      saved = tx;
    });
    expect(() => saved.set(a, 1)).toThrow('already settled');
    expect(() => saved.optimistic(a, 1)).toThrow('already settled');
    expect(a.peek()).toBe(0);
  });

  it('does not track reads made inside the callback', async () => {
    const dep = state(0);
    let runs = 0;
    const stop = watch(() => {
      runs++;
      void transaction(() => {
        dep();
      });
    });
    dep.set(1);
    await tick();
    expect(runs).toBe(1);
    stop();
  });
});
