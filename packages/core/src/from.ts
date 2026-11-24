// ---------------------------------------------------------------------------
// Purity external sources (`@purityjs/core/from`, ADR 0060 slice 2)
//
// from() adapts a push-based external source (a store, an observable, an
// event emitter) into a reactive accessor. The subscription belongs to the
// owner that created it — component, effect run, each() row or root() — and is
// released exactly once when that owner is disposed.
// ---------------------------------------------------------------------------

import { getCurrentContext, itemSignalInternal, untracked } from '@purityjs/signals';

/** Subscribes `set` to an external source; may return the unsubscribe function. */
export type FromSubscribe<T> = (set: (value: T) => void) => (() => void) | void;

/**
 * Read a push-based external source as a reactive accessor. `subscribe` is
 * called once, untracked, with a `set` callback and may return an unsubscribe
 * function; that runs when the calling owner (component, effect run, `each()`
 * row or `root()`) is disposed, and `set` calls after that are ignored. Values
 * are stored as-is (a function value is not called as an updater). Throws
 * outside any owner, where nothing could release the subscription.
 *
 * @example
 * ```ts
 * const price = from<number>((set) => feed.on('price', set), 0); // on() returns off()
 * const user = from(userStore.subscribe); // Svelte-style store contract
 * ```
 */
export function from<T>(subscribe: FromSubscribe<T>): () => T | undefined;
export function from<T>(subscribe: FromSubscribe<T>, initial: T): () => T;
export function from<T>(subscribe: FromSubscribe<T>, initial?: T): () => T | undefined {
  const scope = getCurrentContext();
  if (!scope) {
    throw new TypeError(
      '[Purity] from() needs an owner: call it inside a component, an effect or root().',
    );
  }
  const value = itemSignalInternal(initial);
  let live = true;
  const stop = untracked(() =>
    subscribe((v) => {
      if (live) value(v);
    }),
  );
  (scope.disposers ??= []).push(() => {
    live = false;
    if (stop) stop();
  });
  return () => value();
}
