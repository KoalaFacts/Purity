import { disposeScope, popContext, pushContext, state, watch } from '@purityjs/signals';
import type { Scope } from '@purityjs/signals';
import { describe, expect, it } from 'vitest';
import { pendingTransactions, transaction } from '../src/transaction.ts';

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

describe('pendingTransactions()', () => {
  it('counts running transactions and reaches watchers', async () => {
    const seen: number[] = [];
    const stop = watch(() => {
      seen.push(pendingTransactions());
    });
    const a = deferred();
    const b = deferred();
    const first = transaction(() => a.promise);
    const second = transaction(() => b.promise);
    expect(pendingTransactions()).toBe(2);
    a.resolve();
    await first;
    expect(pendingTransactions()).toBe(1);
    b.resolve();
    await second;
    await tick();
    expect(pendingTransactions()).toBe(0);
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(0);
    expect(Math.max(...seen)).toBe(2);
    stop();
  });

  it('drops in the same batch as the commit', async () => {
    const title = state('a');
    const frames: string[] = [];
    const stop = watch(() => {
      frames.push(`${title()}:${pendingTransactions()}`);
    });
    const gate = deferred();
    const done = transaction(async (tx) => {
      await gate.promise;
      tx.set(title, 'b');
    });
    await tick();
    gate.resolve();
    await done;
    await tick();
    expect(frames).toEqual(['a:0', 'a:1', 'b:0']);
    stop();
  });

  it('drops on rejection, synchronous throw and owner disposal', async () => {
    const failed = transaction(() => Promise.reject(new Error('no')));
    expect(pendingTransactions()).toBe(1);
    await expect(failed).rejects.toThrow('no');
    expect(pendingTransactions()).toBe(0);

    const thrown = transaction(() => {
      throw new Error('sync');
    });
    expect(pendingTransactions()).toBe(0);
    await expect(thrown).rejects.toThrow('sync');

    const scope: Scope = { disposers: null } as Scope;
    pushContext(scope);
    const aborted = transaction(() => new Promise<void>(() => {}));
    popContext();
    expect(pendingTransactions()).toBe(1);
    disposeScope(scope);
    expect(pendingTransactions()).toBe(0);
    await expect(aborted).rejects.toBeDefined();
  });

  it('starting a transaction inside a watch does not subscribe the watch to the count', async () => {
    const trigger = state(0);
    let runs = 0;
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const stop = watch(() => {
      trigger();
      runs++;
      const gate = deferred();
      gates.push(gate);
      void transaction(() => gate.promise).catch(() => {});
    });
    await tick();
    expect(runs).toBe(1);
    gates[0].resolve();
    await tick();
    await tick();
    expect(runs).toBe(1);
    stop();
    for (const g of gates) g.resolve();
  });
});
