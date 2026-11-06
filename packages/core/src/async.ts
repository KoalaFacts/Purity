// ---------------------------------------------------------------------------
// Purity async derivation (`@purityjs/core/async`, ADR 0054)
//
// asyncCompute(fn) feeds a Promise-returning computation into ordinary
// synchronous compute() chains. Unresolved reads throw PendingError, which
// downstream computes cache and rethrow like any other error, so no
// `undefined` or Promise reaches application code as resolved data.
// ---------------------------------------------------------------------------

import { compute, getCurrentContext, state } from '@purityjs/signals';

/** Thrown by reading an {@link asyncCompute} value that has never settled. */
export class PendingError extends Error {
  constructor() {
    super('[Purity] async value is not ready yet');
    this.name = 'PendingError';
  }
}

/** True when `err` is the {@link PendingError} of an unresolved async value. */
export function isPending(err: unknown): err is PendingError {
  return err instanceof PendingError;
}

/** Passed to each {@link asyncCompute} run. */
export interface AsyncComputeInfo {
  /** Aborted when a newer run starts or the value is disposed. */
  signal: AbortSignal;
}

export interface AsyncComputed<T> {
  /**
   * The latest settled value (tracked). Throws {@link PendingError} before the
   * first settlement and rethrows the latest run's rejection.
   */
  (): T;
  /** True while the latest run has not settled (tracked). */
  pending(): boolean;
  /** Abort the in-flight run and stop reacting. Also runs on scope disposal. */
  dispose(): void;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Derive a value from an async computation. `fn` is tracked like `compute()`
 * until it returns; a change to a tracked read starts a new run and aborts the
 * previous one. Only the latest run can become current. After a first value
 * settles, later runs keep returning it while they are in flight.
 *
 * ```ts
 * const user = asyncCompute(({ signal }) => fetchUser(id(), { signal }));
 * const greeting = compute(() => `Hello, ${user().name}`);
 * ```
 */
export function asyncCompute<T>(
  fn: (info: AsyncComputeInfo) => T | PromiseLike<T>,
): AsyncComputed<T> {
  let latest = 0;
  let settledRun = 0;
  let current: Outcome<T> | null = null;
  let controller: AbortController | null = null;
  let disposed = false;
  // Bumped when an async run settles, outside any pull.
  const settled = state(0);

  const settle = (run: number, result: Outcome<T>): void => {
    current = result;
    settledRun = run;
  };

  const runner = compute((): number => {
    if (disposed) return latest;
    controller?.abort();
    const ctrl = (controller = new AbortController());
    const run = ++latest;
    let result: T | PromiseLike<T>;
    try {
      result = fn({ signal: ctrl.signal });
    } catch (error) {
      // An unresolved upstream async value keeps this run pending; the
      // upstream settlement re-runs fn through the tracked read.
      if (!isPending(error)) settle(run, { ok: false, error });
      return run;
    }
    if (typeof (result as PromiseLike<T> | null)?.then === 'function') {
      const finish = (outcome: Outcome<T>): void => {
        if (run !== latest || disposed) return;
        settle(run, outcome);
        settled(settled.peek() + 1);
      };
      // Promise.resolve: a thenable that calls back synchronously still
      // settles after the current pull, never inside it.
      Promise.resolve(result).then(
        (value) => finish({ ok: true, value }),
        (error) => finish({ ok: false, error }),
      );
    } else {
      settle(run, { ok: true, value: result as T });
    }
    return run;
  });

  // Readers depend on the outcome, not on run starts: a new run that keeps
  // the retained outcome returns the same object, so the equality cut-off
  // stops it from re-running downstream derivations with stale input.
  const outcome = compute((): Outcome<T> | null => {
    runner();
    settled();
    return current;
  });

  const read = (() => {
    const result = outcome();
    if (result === null) throw new PendingError();
    if (result.ok) return result.value;
    throw result.error;
  }) as AsyncComputed<T>;

  read.pending = () => {
    const run = runner();
    settled();
    return !disposed && settledRun !== run;
  };

  read.dispose = () => {
    if (disposed) return;
    disposed = true;
    controller?.abort();
    controller = null;
  };

  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(read.dispose);

  return read;
}
