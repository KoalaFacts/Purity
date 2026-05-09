// ---------------------------------------------------------------------------
// debounced — derived signal that mirrors `source` but waits `ms` of quiet
// before propagating updates. Common pairing: feed a search input through
// debounced() into a resource() source.
// ---------------------------------------------------------------------------

import { type ComputedAccessor, state, watch } from './signals.ts';

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
 *
 * @example
 * ```ts
 * const search = state('');
 * const query = debounced(search, 300);
 * const results = resource(() => query() || null, (q, { signal }) =>
 *   fetch(`/search?q=${q}`, { signal }).then(r => r.json()),
 * );
 * ```
 */
export function debounced<T>(source: () => T, ms: number): DebouncedAccessor<T> {
  // Initial value captured outside any tracking context so first read is sync.
  const out = state<T>(source());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstRun = true;

  const cleanup = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const stop = watch(() => {
    const v = source();
    if (firstRun) {
      firstRun = false;
      return cleanup;
    }
    cleanup();
    timer = setTimeout(() => {
      timer = null;
      out(v);
    }, ms);
    return cleanup;
  });

  const accessor = out.get as DebouncedAccessor<T>;
  accessor.get = out.get;
  accessor.peek = out.peek;
  accessor.dispose = () => {
    cleanup();
    stop();
  };
  return accessor;
}
