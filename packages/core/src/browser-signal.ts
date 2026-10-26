import { withoutScope } from './scope.ts';
import { compute, state, type ComputedAccessor, type Dispose } from './signals.ts';

/** Page-lifetime cache; never owned by an individual consumer. @internal */
export interface BrowserSignal<T> {
  value: ComputedAccessor<T> | null;
  stop: Dispose | null;
}

/** Initialize only after the adapter's platform guard and cache lookup. @internal */
export function createBrowserSignal<T>(
  cache: BrowserSignal<T>,
  read: () => T,
  bind: (write: (value: T) => void) => Dispose | null,
  fallback: () => T = read,
): ComputedAccessor<T> {
  const inner = state(read());
  cache.stop = bind(inner.set);
  // Failed bindings remain uncached so a later call can retry. Preserve the
  // fallback's normal ownership and the successful source's equality filter.
  if (!cache.stop) return compute(fallback);
  return (cache.value = withoutScope(() => compute(inner.get)));
}

/** Separate from initialization so production users can omit test resets. @internal */
export function resetBrowserSignal<T>(cache: BrowserSignal<T>): void {
  cache.stop?.();
  cache.stop = null;
  cache.value = null;
}
