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
  // Validate `ms` up front: setTimeout silently clamps NaN/negative to 0 and
  // accepts Infinity (which is almost certainly a bug at the call site).
  // Surfacing this immediately is friendlier than a confused-debounce later.
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    throw new RangeError(
      `[Purity] debounced(): ms must be a finite, non-negative number (got ${String(ms)})`,
    );
  }

  // Initial value captured outside any tracking context so first read is sync.
  const out = state<T>(source());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstRun = true;
  let disposed = false;

  const cleanup = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const stop = watch(() => {
    // Isolate source-throw: a throwing source() on a subsequent run would
    // otherwise (a) tear down the watcher's source slots and (b) leave us
    // without a re-arm path on the next dependency change. Catch, log, and
    // keep the previous debounced value — matching how the rest of the
    // codebase handles user-callback throws (see flush() and resource()).
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
    // Guard the timer-fired write so a disposal that races the macrotask
    // boundary (cleanup ran, then the queued callback still fires because
    // the runtime had already pulled it off the timer heap) cannot reach
    // into `out` after dispose.
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
    // Idempotent: subsequent dispose() calls must be a no-op so callers can
    // safely fire-and-forget without tracking ownership.
    if (disposed) return;
    disposed = true;
    cleanup();
    stop();
  };
  return accessor;
}
