import { bindListeners, isolate, type ListenerSpec } from './listen.ts';
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
  read: (event?: Event) => T,
  target: EventTarget,
  events: readonly string[],
  label: string,
  isolateErrors = false,
  fallback: () => T = read,
): ComputedAccessor<T> {
  const inner = state(read());
  const update = (event: Event): void => inner.set(read(event));
  const handler = isolateErrors ? isolate(label, update) : update;
  cache.stop = bindListeners(
    events.map((name): ListenerSpec => [target, name, handler]),
    label,
  );
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
