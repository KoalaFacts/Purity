import { Signal } from 'signal-polyfill';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Reactive state accessor. Call to read, call with value to write.
 *
 * @example
 * ```ts
 * const count = state(0);
 * count()          // read → 0
 * count(5)         // write → 5
 * count(v => v+1)  // update → 6
 * count.peek()     // read without tracking
 * ```
 */
export interface StateAccessor<T> {
  /** Read the current value (tracked by watch/compute). */
  (): T;
  /** Set a new value. */
  (value: T): T;
  /** Update via callback — receives current value, returns new value. */
  (updater: (current: T) => T): T;
  /** Read the current value (tracked). */
  get(): T;
  /** Set a new value. */
  set(value: T): void;
  /** Read without tracking — won't trigger watch/compute. */
  peek(): T;
  /** Internal: the underlying Signal.State instance. */
  readonly _signal: Signal.State<T>;
}

/**
 * Reactive computed accessor. Read-only derived value.
 *
 * @example
 * ```ts
 * const doubled = compute(() => count() * 2);
 * doubled()      // read derived value
 * doubled.peek() // read without tracking
 * ```
 */
export interface ComputedAccessor<T> {
  /** Read the derived value (tracked). */
  (): T;
  /** Read the derived value (tracked). */
  get(): T;
  /** Read without tracking. */
  peek(): T;
  /** Internal: the underlying Signal.Computed instance. */
  readonly _signal: Signal.Computed<T>;
}

/** Cleanup function returned by watch(). Call to stop watching. */
export type Dispose = () => void;

export interface EffectHandle {
  _computed: Signal.Computed<void>;
  _dispose(): void;
}

// ---------------------------------------------------------------------------
// Effect scheduler — single microtask per tick, no redundant scheduling
// ---------------------------------------------------------------------------

let pending = false;
let microtaskScheduled = false;

const watcher = new Signal.subtle.Watcher(() => {
  pending = true;
  if (!microtaskScheduled) {
    microtaskScheduled = true;
    queueMicrotask(flush);
  }
});

function flush(): void {
  microtaskScheduled = false;
  pending = false;

  const dirty = watcher.getPending();
  watcher.watch(...dirty);

  for (let i = 0; i < dirty.length; i++) {
    dirty[i].get();
  }
}

// ---------------------------------------------------------------------------
// state(initialValue)
// ---------------------------------------------------------------------------

/**
 * Create reactive state. Returns an accessor function.
 *
 * @example
 * ```ts
 * const count = state(0);
 * count()              // read → 0
 * count(5)             // write → 5
 * count(v => v + 1)    // update with callback → 6
 *
 * // In templates — wrap in arrow for reactivity:
 * html`<p>${() => count()}</p>`
 *
 * // Two-way binding on inputs:
 * html`<input ::value=${count} />`
 * ```
 */
export function state<T>(initial: T): StateAccessor<T> {
  const s = new Signal.State<T>(initial);
  // Cache peek closure once, not per call
  const peekFn = () => Signal.subtle.untrack(() => s.get());

  const accessor = ((...args: [T | ((current: T) => T)] | []): T => {
    if (args.length === 0) return s.get();
    const value = args[0];
    if (typeof value === 'function') {
      const next = (value as (current: T) => T)(s.get());
      s.set(next);
      return next;
    }
    s.set(value as T);
    return value as T;
  }) as StateAccessor<T>;

  (accessor as any).get = () => s.get();
  (accessor as any).set = (v: T) => s.set(v);
  (accessor as any).peek = peekFn;
  (accessor as any)._signal = s;

  return accessor;
}

// ---------------------------------------------------------------------------
// compute(fn)
// ---------------------------------------------------------------------------

/**
 * Create a computed (derived) value. Re-evaluates when dependencies change.
 *
 * @example
 * ```ts
 * const count = state(0);
 * const doubled = compute(() => count() * 2);
 * doubled()  // → 0
 * count(5);
 * doubled()  // → 10
 *
 * // In templates:
 * html`<p>${() => doubled()}</p>`
 * ```
 */
export function compute<T>(fn: () => T): ComputedAccessor<T> {
  const c = new Signal.Computed<T>(fn);
  const peekFn = () => Signal.subtle.untrack(() => c.get());

  const accessor = (() => c.get()) as ComputedAccessor<T>;

  (accessor as any).get = () => c.get();
  (accessor as any).peek = peekFn;
  (accessor as any)._signal = c;

  return accessor;
}

// ---------------------------------------------------------------------------
// Internal effect runner
// ---------------------------------------------------------------------------

let _currentEffect: EffectHandle | null = null;

const MAX_EFFECT_DEPTH = 100;
let effectDepth = 0;

function _effect(fn: () => undefined | Dispose): Dispose {
  let cleanup: undefined | Dispose;
  let disposed = false;

  const c = new Signal.Computed<void>(() => {
    if (typeof cleanup === 'function') {
      cleanup();
      cleanup = undefined;
    }

    if (disposed) return;

    // Re-entrancy guard — prevent infinite loops
    if (++effectDepth > MAX_EFFECT_DEPTH) {
      effectDepth = 0;
      throw new Error(
        '[Purity] Maximum effect depth exceeded. ' +
          'A watch/effect callback is likely modifying the signal it depends on.',
      );
    }

    const prevEffect = _currentEffect;
    _currentEffect = effectHandle;
    try {
      cleanup = fn();
    } finally {
      _currentEffect = prevEffect;
      effectDepth--;
    }
  });

  const effectHandle: EffectHandle = {
    _computed: c,
    _dispose() {
      disposed = true;
      watcher.unwatch(c);
      if (typeof cleanup === 'function') {
        cleanup();
        cleanup = undefined;
      }
    },
  };

  watcher.watch(c);
  c.get();

  return () => effectHandle._dispose();
}

// ---------------------------------------------------------------------------
// watch — unified reactive watcher
// ---------------------------------------------------------------------------

export type WatchSource<T> = StateAccessor<T> | ComputedAccessor<T> | (() => T);

type InferSource<S> = S extends WatchSource<infer T> ? T : never;

type InferSources<S extends readonly WatchSource<any>[]> = {
  [K in keyof S]: InferSource<S[K]>;
};

/**
 * Watch reactive values and run side effects.
 *
 * **Auto-track** — runs immediately, re-runs when any accessed signal changes:
 * ```ts
 * watch(() => console.log(count()));
 * ```
 *
 * **Explicit source** — runs callback when source changes (skips initial):
 * ```ts
 * watch(count, (newVal, oldVal) => {
 *   console.log(`changed from ${oldVal} to ${newVal}`);
 * });
 * ```
 *
 * **Multiple sources** — watches a tuple of signals:
 * ```ts
 * watch([count, name], ([c, n], [oldC, oldN]) => {
 *   console.log(c, n);
 * });
 * ```
 *
 * **Cleanup** — return a function from the callback to clean up before re-run:
 * ```ts
 * const stop = watch(() => {
 *   const id = setInterval(() => tick(), 1000);
 *   return () => clearInterval(id);  // cleanup
 * });
 * stop(); // dispose the watcher
 * ```
 *
 * @returns Dispose function — call to stop watching.
 */
export function watch(fn: () => undefined | Dispose): Dispose;
export function watch<T>(
  source: WatchSource<T>,
  cb: (value: T, oldValue: T) => undefined | Dispose,
): Dispose;
export function watch<const S extends readonly WatchSource<any>[]>(
  sources: [...S],
  cb: (values: InferSources<S>, oldValues: InferSources<S>) => undefined | Dispose,
): Dispose;

export function watch(
  sourceOrFn: WatchSource<any> | WatchSource<any>[] | (() => undefined | Dispose),
  cb?: (value: any, oldValue: any) => undefined | Dispose,
): Dispose {
  if (!cb) {
    return _effect(sourceOrFn as () => undefined | Dispose);
  }

  const isArray = Array.isArray(sourceOrFn);
  const sources: WatchSource<any>[] = isArray ? sourceOrFn : [sourceOrFn as WatchSource<any>];
  const len = sources.length;

  // Pre-allocate arrays — reuse across cycles, no .map()
  let oldValues = new Array(len);
  let newValues = new Array(len);
  for (let i = 0; i < len; i++) oldValues[i] = sources[i]();

  let first = true;

  return _effect(() => {
    for (let i = 0; i < len; i++) newValues[i] = sources[i]();

    if (first) {
      first = false;
      // Swap refs
      const tmp = oldValues;
      oldValues = newValues;
      newValues = tmp;
      return;
    }

    const result = isArray ? cb(newValues, oldValues) : cb(newValues[0], oldValues[0]);

    // Swap refs instead of allocating
    const tmp = oldValues;
    oldValues = newValues;
    newValues = tmp;

    return result;
  });
}

// ---------------------------------------------------------------------------
// batch(fn)
// ---------------------------------------------------------------------------

/**
 * Batch multiple signal writes into a single flush. Effects only run once after the batch.
 *
 * @example
 * ```ts
 * batch(() => {
 *   firstName('Jane');
 *   lastName('Doe');
 *   age(30);
 * });
 * // Effects that depend on these signals fire once, not three times.
 * ```
 */
export function batch(fn: () => void): void {
  const wasPending = pending;
  pending = true;
  try {
    fn();
  } finally {
    pending = wasPending;
    if (!wasPending && !microtaskScheduled) {
      microtaskScheduled = true;
      queueMicrotask(flush);
    }
  }
}

export { Signal };
