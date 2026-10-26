import { withoutScope } from './scope.ts';
import { compute, state, type ComputedAccessor, type Dispose } from './signals.ts';

interface BrowserSignal<T> {
  (): ComputedAccessor<T>;
  reset(): void;
}

/** Lazy page-lifetime source shared by browser signal adapters. @internal */
export function createBrowserSignal<T>(
  read: () => T,
  bind: (write: (value: T) => void) => Dispose | null,
  fallback: () => T = read,
): BrowserSignal<T> {
  let singleton: ComputedAccessor<T> | null = null;
  let unbind: Dispose | null = null;
  const get = (): ComputedAccessor<T> => {
    if (singleton) return singleton;
    const inner = state(read());
    unbind = bind(inner.set);
    // Keep failed bindings uncached, so a later call can retry. The fallback
    // retains the caller's normal ownership, as in the individual adapters.
    if (!unbind) return compute(fallback);
    // A shared source must outlive its first consumer. Retain the computed
    // equality filter: a same-tick round trip must not notify subscribers.
    singleton = withoutScope(() => compute(inner.get));
    return singleton;
  };
  get.reset = (): void => {
    unbind?.();
    unbind = null;
    singleton = null;
  };
  return get;
}
