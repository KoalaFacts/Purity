import { Signal } from 'signal-polyfill';

// ---------------------------------------------------------------------------
// Effect scheduler — batches microtask flushes so multiple signal writes
// within the same tick only trigger one round of effect re-evaluation.
// ---------------------------------------------------------------------------

let pending = false;
const needsEnqueue = true;

const watcher = new Signal.subtle.Watcher(() => {
  if (!pending) {
    pending = true;
    queueMicrotask(flush);
  }
});

function flush() {
  pending = false;

  // getPending() returns the list of watched Computed signals whose
  // dependencies have changed since last evaluation.
  const dirty = watcher.getPending();

  // Re-subscribe before evaluating so that if an effect's deps change during
  // evaluation the watcher still tracks the new set.
  watcher.watch(...dirty);

  for (const computed of dirty) {
    computed.get(); // re-evaluate — this runs the user's effect callback
  }
}

// ---------------------------------------------------------------------------
// state(initialValue) — reactive read/write accessor
//
//   const count = state(0);
//   count()        // read  → 0
//   count(1)       // write → sets to 1
//   count.get()    // read  (alternative)
//   count.set(2)   // write (alternative)
//   count.peek()   // read without tracking
// ---------------------------------------------------------------------------

export function state(initial) {
  const s = new Signal.State(initial);

  function accessor(value) {
    if (arguments.length === 0) return s.get();
    s.set(value);
    return value;
  }

  accessor.get = () => s.get();
  accessor.set = (v) => s.set(v);
  accessor.peek = () => Signal.subtle.untrack(() => s.get());
  accessor._signal = s;

  return accessor;
}

// ---------------------------------------------------------------------------
// computed(fn) — reactive read-only derived value
//
//   const doubled = computed(() => count() * 2);
//   doubled()       // read
//   doubled.get()   // read (alternative)
//   doubled.peek()  // read without tracking
// ---------------------------------------------------------------------------

export function computed(fn) {
  const c = new Signal.Computed(fn);

  function accessor() {
    return c.get();
  }

  accessor.get = () => c.get();
  accessor.peek = () => Signal.subtle.untrack(() => c.get());
  accessor._signal = c;

  return accessor;
}

// ---------------------------------------------------------------------------
// effect(fn) — auto-tracking side effect
//
// Runs `fn` immediately, tracks which signals are read, and re-runs `fn`
// whenever any tracked signal changes. If `fn` returns a function, that
// function is called as cleanup before the next re-run and on disposal.
//
// Returns a dispose function.
//
//   const stop = effect(() => {
//     console.log(count());
//     return () => console.log('cleanup');
//   });
//   stop(); // dispose the effect
// ---------------------------------------------------------------------------

// Context for the currently executing effect (used by component lifecycle)
let _currentEffect = null;

export function getCurrentEffect() {
  return _currentEffect;
}

export function effect(fn) {
  let cleanup;
  let disposed = false;

  const c = new Signal.Computed(() => {
    // Run cleanup from previous execution
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

  const effectHandle = {
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
  c.get(); // initial run — establishes dependency tracking

  return () => effectHandle._dispose();
}

// ---------------------------------------------------------------------------
// batch(fn) — batch multiple state updates into a single flush
// ---------------------------------------------------------------------------

export function batch(fn) {
  // Signal.subtle doesn't have built-in batching, but since our scheduler
  // already defers to a microtask, synchronous writes within `fn` will
  // naturally batch. We just need to make sure flush doesn't run mid-batch.
  const wasPending = pending;
  pending = true; // prevent flush during batch
  try {
    fn();
  } finally {
    pending = wasPending;
    if (!wasPending) {
      // Trigger a flush after batch completes
      queueMicrotask(flush);
    }
  }
}

// Re-export Signal for advanced usage
export { Signal };
