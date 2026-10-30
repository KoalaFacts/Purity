// ---------------------------------------------------------------------------
// debounced — derived signal that mirrors `source` but waits `ms` of quiet
// before propagating updates. Common pairing: feed a search input through
// debounced() into a resource() source.
// ---------------------------------------------------------------------------

import { type ComputedAccessor, state, watch } from './signals.ts';

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(id: unknown): void;
declare const console: { error(...args: unknown[]): void };

/**
 * Debounced read-only accessor with an explicit dispose. Inside a component
 * the underlying watcher auto-disposes on unmount; `dispose()` is the escape
 * hatch for module-scope or test usage.
 */
export interface DebouncedAccessor<T> extends ComputedAccessor<T> {
  dispose(): void;
}

/**
 * Debounced read-only accessor. Mirrors `source` after `ms` of no further
 * changes. The initial value is observed synchronously; subsequent updates
 * are delayed.
 */
export function debounced<T>(source: () => T, ms: number): DebouncedAccessor<T> {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    throw new RangeError(
      `[Purity] debounced(): ms must be a finite, non-negative number (got ${String(ms)})`,
    );
  }

  const out = state<T>(source());
  let timer: unknown = null;
  let firstRun = true;
  let disposed = false;

  const cleanup = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const stop = watch(() => {
    let v: T;
    try {
      v = source();
    } catch (e) {
      console.error('[Purity] debounced() source threw:', e);
      return cleanup;
    }
    if (firstRun) {
      firstRun = false;
      return cleanup;
    }
    cleanup();
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      out(v);
    }, ms);
    return cleanup;
  });

  const accessor = out.get as DebouncedAccessor<T>;
  accessor.get = out.get;
  accessor.peek = out.peek;
  accessor.dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanup();
    stop();
  };
  return accessor;
}
