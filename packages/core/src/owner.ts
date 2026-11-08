// ---------------------------------------------------------------------------
// Purity owner composition (`@purityjs/core/owner`, ADR 0060)
//
// getOwner() captures the scope that owns the running code (a component, an
// effect run, an each() row, a root). runWithOwner() re-enters it later — from
// a timer, a subscription or a resolved promise — so work created there is
// released with that owner. root() creates a deliberately detached owner with
// an explicit, exactly-once release.
// ---------------------------------------------------------------------------

import {
  type ComponentContext,
  disposeScope,
  getCurrentContext,
  popContext,
  pushContext,
  type Scope,
  untracked,
  withoutScope,
} from '@purityjs/signals';

/** Opaque handle to a live (or released) owner, from {@link getOwner}. */
export interface Owner {
  /** False once the owner has been disposed; work re-entering it is released at once. */
  readonly alive: boolean;
}

interface OwnerHandle extends Owner {
  alive: boolean;
  scope: Scope;
}

// One handle per live owner run; a re-running effect gets a new one.
const handles = new WeakMap<Scope, OwnerHandle>();
const issued = new WeakSet<object>();

/** The owner of the running code, or `null` outside any component, effect or root. */
export function getOwner(): Owner | null {
  const scope = getCurrentContext();
  if (!scope) return null;
  let handle = handles.get(scope);
  if (!handle) {
    const h: OwnerHandle = { alive: !(scope as ComponentContext)._isDestroyed, scope };
    handles.set(scope, (handle = h));
    issued.add(h);
    if (h.alive)
      (scope.disposers ??= []).push(() => {
        h.alive = false;
        if (handles.get(scope) === h) handles.delete(scope);
      });
  }
  return handle;
}

/**
 * Run `fn` synchronously as if it were called inside `owner`: watches,
 * computes, `onDispose()` callbacks and components it creates are released
 * with that owner. Reads in `fn` do not subscribe the caller. If the owner is
 * already disposed, everything `fn` registered is released before this returns.
 */
export function runWithOwner<T>(owner: Owner, fn: () => T): T {
  const handle = owner as OwnerHandle;
  if (!issued.has(handle)) {
    throw new TypeError('[Purity] runWithOwner() expects a handle returned by getOwner().');
  }
  const dead = !handle.alive || !!(handle.scope as ComponentContext)._isDestroyed;
  const scope: Scope = dead ? {} : handle.scope;
  // Only the re-entered owner is visible to fn, never the caller's owners.
  return withoutScope(() => {
    pushContext(scope);
    try {
      return untracked(fn);
    } finally {
      popContext();
      if (dead) disposeScope(scope);
    }
  });
}

/**
 * Create a detached owner: work created in `fn` is not released by the
 * caller's owner, only by the `dispose` function passed to `fn` (idempotent).
 * Returns what `fn` returns. If `fn` throws, the root is released and the
 * error rethrown.
 */
export function root<T>(fn: (dispose: () => void) => T): T {
  const scope: Scope = {};
  let released = false;
  const dispose = (): void => {
    if (released) return;
    released = true;
    disposeScope(scope);
  };
  return withoutScope(() => {
    pushContext(scope);
    try {
      return untracked(() => fn(dispose));
    } catch (err) {
      dispose();
      throw err;
    } finally {
      popContext();
    }
  });
}
