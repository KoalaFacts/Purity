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
  /**
   * The unresolved {@link asyncCompute} value whose read threw this error;
   * `loading()` waits on its `pending()` before rendering again.
   */
  source?: AsyncComputed<unknown>;
  constructor(source?: AsyncComputed<unknown>) {
    super('[Purity] async value is not ready yet');
    this.name = 'PendingError';
    this.source = source;
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

// `v` is the value when `ok`, otherwise the error.
type Outcome = { ok: boolean; v: unknown };

/**
 * Derive a value from an async computation. `fn` is tracked like `compute()`
 * until it returns; a change to a tracked read starts a new run and aborts the
 * previous one. Only the latest run can become current. After a first value
 * settles, later runs keep returning it while they are in flight. When `fn`
 * returns an `AsyncIterable`, every yielded value becomes current in turn and
 * the iterator is closed (`return()`) when the run is superseded or disposed.
 *
 * ```ts
 * const user = asyncCompute(({ signal }) => fetchUser(id(), { signal }));
 * const greeting = compute(() => `Hello, ${user().name}`);
 * ```
 */
export function asyncCompute<T>(
  fn: (info: AsyncComputeInfo) => T | PromiseLike<T> | AsyncIterable<T>,
): AsyncComputed<T> {
  let latest = 0;
  let settledRun = 0;
  let current: Outcome | null = null;
  let controller: AbortController | null = null;
  let disposed = false;
  // Bumped when an async run settles, outside any pull.
  const settled = state(0);

  const settle = (run: number, ok: boolean, v: unknown): void => {
    // An equal value keeps the retained outcome object, so the outcome
    // compute's equality cut-off does not re-run downstream readers.
    if (!(current?.ok && ok && Object.is(current.v, v))) current = { ok, v };
    settledRun = run;
  };

  const runner = compute((): number => {
    if (disposed) return latest;
    controller?.abort();
    const ctrl = (controller = new AbortController());
    const run = ++latest;
    let result: T | PromiseLike<T> | AsyncIterable<T>;
    try {
      result = fn({ signal: ctrl.signal });
    } catch (error) {
      // An unresolved upstream async value keeps this run pending; the
      // upstream settlement re-runs fn through the tracked read.
      if (!isPending(error)) settle(run, false, error);
      return run;
    }
    const iterate = (result as AsyncIterable<T> | null)?.[Symbol.asyncIterator];
    if (iterate || typeof (result as PromiseLike<T> | null)?.then === 'function') {
      // True when the outcome was accepted (the run is still current).
      const finish = (ok: boolean, v: unknown): boolean => {
        if (run !== latest || disposed) return false;
        settle(run, ok, v);
        settled(settled.peek() + 1);
        return true;
      };
      // Every yielded value becomes current; a promise is a one-value stream.
      // The generator also defers a thenable that calls back synchronously
      // until after the current pull. Supersession and disposal abort the
      // run, which closes the iterator; a rejecting return() surfaces as an
      // unhandled rejection rather than being swallowed.
      const it: AsyncIterator<T> = iterate
        ? iterate.call(result)
        : (async function* () {
            yield await (result as PromiseLike<T>);
          })();
      ctrl.signal.onabort = () => it.return?.();
      const step = (): void => {
        it.next().then(
          (r) => {
            if (!r.done && finish(true, r.value)) step();
          },
          (error) => {
            // An async fn that read an unresolved upstream stays pending, like
            // the synchronous PendingError path; the upstream settlement re-runs it.
            if (!isPending(error)) finish(false, error);
          },
        );
      };
      step();
    } else {
      settle(run, true, result);
    }
    return run;
  });

  // Readers depend on the outcome, not on run starts: a new run that keeps
  // the retained outcome returns the same object, so the equality cut-off
  // stops it from re-running downstream derivations with stale input.
  const outcome = compute((): Outcome | null => {
    runner();
    settled();
    return current;
  });

  const read = (() => {
    const result = outcome();
    if (result === null) throw new PendingError(read);
    if (result.ok) return result.v as T;
    throw result.v;
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
