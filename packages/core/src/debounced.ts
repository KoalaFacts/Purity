// ---------------------------------------------------------------------------
// debounced — derived signal that mirrors `source` but waits `ms` of quiet
// before propagating updates. Common pairing: feed a search input through
// debounced() into a resource() source.
// ---------------------------------------------------------------------------

import { type ComputedAccessor, state, watch } from './signals.ts';

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
export function debounced<T>(source: () => T, ms: number): ComputedAccessor<T> {
  // Capture initial value outside any tracking context so the debounced
  // accessor reflects the source synchronously on first read.
  const initial = source();
  const out = state<T>(initial);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstRun = true;

  watch(() => {
    const v = source();
    if (firstRun) {
      firstRun = false;
      return () => {
        if (timer !== null) clearTimeout(timer);
      };
    }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      out(v);
    }, ms);
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  });

  const accessor = (() => out()) as ComputedAccessor<T>;
  accessor.get = () => out();
  accessor.peek = () => out.peek();
  return accessor;
}
