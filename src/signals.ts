import { Signal } from 'signal-polyfill';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StateAccessor<T> {
  (): T;
  (value: T): T;
  (updater: (current: T) => T): T;
  get(): T;
  set(value: T): void;
  peek(): T;
  readonly _signal: Signal.State<T>;
}

export interface ComputedAccessor<T> {
  (): T;
  get(): T;
  peek(): T;
  readonly _signal: Signal.Computed<T>;
}

export type Dispose = () => void;

export interface EffectHandle {
  _computed: Signal.Computed<void>;
  _dispose(): void;
}

// ---------------------------------------------------------------------------
// Effect scheduler — batches microtask flushes so multiple signal writes
// within the same tick only trigger one round of effect re-evaluation.
// ---------------------------------------------------------------------------

let pending = false;

const watcher = new Signal.subtle.Watcher(() => {
  if (!pending) {
    pending = true;
    queueMicrotask(flush);
  }
});

function flush(): void {
  pending = false;

  const dirty = watcher.getPending();
  watcher.watch(...dirty);

  for (const computed of dirty) {
    computed.get();
  }
}

// ---------------------------------------------------------------------------
// state(initialValue) — reactive read/write accessor
// ---------------------------------------------------------------------------

export function state<T>(initial: T): StateAccessor<T> {
  const s = new Signal.State<T>(initial);

  const accessor = function (value?: T | ((current: T) => T)): T {
    if (arguments.length === 0) return s.get();
    if (typeof value === 'function') {
      const next = (value as (current: T) => T)(s.get());
      s.set(next);
      return next;
    }
    s.set(value!);
    return value!;
  } as StateAccessor<T>;

  (accessor as any).get = () => s.get();
  (accessor as any).set = (v: T) => s.set(v);
  (accessor as any).peek = () => Signal.subtle.untrack(() => s.get());
  (accessor as any)._signal = s;

  return accessor;
}

// ---------------------------------------------------------------------------
// compute(fn) — reactive read-only derived value
// ---------------------------------------------------------------------------

export function compute<T>(fn: () => T): ComputedAccessor<T> {
  const c = new Signal.Computed<T>(fn);

  const accessor = function (): T {
    return c.get();
  } as ComputedAccessor<T>;

  (accessor as any).get = () => c.get();
  (accessor as any).peek = () => Signal.subtle.untrack(() => c.get());
  (accessor as any)._signal = c;

  return accessor;
}

// ---------------------------------------------------------------------------
// Internal effect runner (used by both watch overloads)
// ---------------------------------------------------------------------------

let _currentEffect: EffectHandle | null = null;

export function getCurrentEffect(): EffectHandle | null {
  return _currentEffect;
}

function _effect(fn: () => void | Dispose): Dispose {
  let cleanup: void | Dispose;
  let disposed = false;

  const c = new Signal.Computed<void>(() => {
    if (typeof cleanup === 'function') {
      cleanup();
      cleanup = undefined;
    }

    if (disposed) return;

    const prevEffect = _currentEffect;
    _currentEffect = effectHandle;
    try {
      cleanup = fn();
    } finally {
      _currentEffect = prevEffect;
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
//
//   watch(() => console.log(count()))              // auto-track
//   watch(count, (val, old) => { ... })            // explicit source
//   watch([a, b], ([va, vb], [oa, ob]) => { ... }) // multiple sources
// ---------------------------------------------------------------------------

export type WatchSource<T> = StateAccessor<T> | ComputedAccessor<T> | (() => T);

// Infer T from a WatchSource<T>
type InferSource<S> = S extends WatchSource<infer T> ? T : never;

// Map a tuple of WatchSources to a tuple of their value types
type InferSources<S extends readonly WatchSource<any>[]> = {
  [K in keyof S]: InferSource<S[K]>;
};

// Overload: auto-tracking effect
export function watch(fn: () => void | Dispose): Dispose;

// Overload: single source
export function watch<T>(
  source: WatchSource<T>,
  cb: (value: T, oldValue: T) => void | Dispose
): Dispose;

// Overload: multiple sources (tuple inference)
export function watch<const S extends readonly WatchSource<any>[]>(
  sources: [...S],
  cb: (values: InferSources<S>, oldValues: InferSources<S>) => void | Dispose
): Dispose;

export function watch(
  sourceOrFn: WatchSource<any> | WatchSource<any>[] | (() => void | Dispose),
  cb?: (value: any, oldValue: any) => void | Dispose
): Dispose {
  // Auto-track overload: watch(() => { ... })
  if (!cb) {
    return _effect(sourceOrFn as () => void | Dispose);
  }

  // Explicit source overload
  const isArray = Array.isArray(sourceOrFn);
  const sources: WatchSource<any>[] = isArray
    ? sourceOrFn
    : [sourceOrFn as WatchSource<any>];

  const read = (): any[] => sources.map((s) => s());

  let oldValues = read();
  let first = true;

  return _effect(() => {
    const newValues = read();

    if (first) {
      first = false;
      oldValues = newValues;
      return;
    }

    const result = isArray
      ? cb(newValues, oldValues)
      : cb(newValues[0], oldValues[0]);

    oldValues = newValues;
    return result;
  });
}


// ---------------------------------------------------------------------------
// batch(fn) — batch multiple state updates into a single flush
// ---------------------------------------------------------------------------

export function batch(fn: () => void): void {
  const wasPending = pending;
  pending = true;
  try {
    fn();
  } finally {
    pending = wasPending;
    if (!wasPending) {
      queueMicrotask(flush);
    }
  }
}

export { Signal };
