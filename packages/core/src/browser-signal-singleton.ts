// Internal page-lifetime cache for browser-backed readonly signals.
// Keep SSR checks in callers: server snapshots must never reuse client state.
import { withoutScope } from './scope.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';

export function createSharedBrowserSignal<T>(
  read: () => T,
  subscribe: (update: (value: T) => void) => (() => void) | null,
  fallback: () => T = read,
) {
  let singleton: ComputedAccessor<T> | null = null;
  let detach: (() => void) | null = null;
  return {
    get(): ComputedAccessor<T> {
      if (singleton) return singleton;
      const inner = state(read());
      const nextDetach = subscribe((value) => inner(value));
      if (!nextDetach) return compute(fallback);
      detach = nextDetach;
      // One shared signal may be read by many independently disposed owners.
      singleton = withoutScope(() => compute(inner.get));
      return singleton;
    },
    reset(): void {
      detach?.();
      detach = null;
      singleton = null;
    },
  };
}
