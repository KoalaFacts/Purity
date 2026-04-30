import { getCurrentContext } from './component.ts';

// ---------------------------------------------------------------------------
// Reactivity core
//
// Push-pull, version-tracked graph. Plain-object nodes (no classes, no
// private slots) so V8 can inline the shape — every State and Computed is a
// fixed-shape literal, allocations land on the same hidden class.
//
// Status states:
//   CLEAN  — value is current, all sources consistent
//   CHECK  — an ancestor was DIRTY, so we MIGHT be dirty; resolve by walking
//            sources and comparing versions before re-running
//   DIRTY  — known stale; must re-run to refresh value
//
// Propagation runs in two phases (Solid-style):
//  1. write() bumps version, marks direct observers DIRTY, transitive CHECK,
//     and queues effect nodes onto the pending list.
//  2. flush() pulls each pending effect: walks its sources, recursively
//     updates dirty computeds top-down, then re-runs the effect only if a
//     source's version actually changed. CHECK→CLEAN without a re-run is
//     the glitch-freedom mechanism.
// ---------------------------------------------------------------------------

// const enum would inline these but Node's TS strip mode rejects them.
const STATUS_CLEAN = 0;
const STATUS_CHECK = 1;
const STATUS_DIRTY = 2;
type Status = 0 | 1 | 2;

interface StateNode<T> {
  /** Discriminator: state has no fn. */
  fn: null;
  value: T;
  /** Bumps every time `value` actually changes. Consumers cache it to detect change without re-running fn. */
  version: number;
  observers: ComputedNode[] | null;
}

interface ComputedNode {
  fn: () => unknown;
  value: unknown;
  version: number;
  status: Status;
  sources: AnyNode[] | null;
  /** Snapshot of each source's `version` as observed during the last fn() run. */
  sourceVersions: number[] | null;
  observers: ComputedNode[] | null;
  /** Function returned from a watch fn body; runs before next re-run and on dispose. */
  cleanup: (() => void) | null;
  /** True for watch effects (must re-run for side effects); false for compute (lazy). */
  isEffect: boolean;
  disposed: boolean;
}

type AnyNode = StateNode<unknown> | ComputedNode;

let activeListener: ComputedNode | null = null;
/** Position cursor while activeListener is running fn(); enables in-place source slot reuse. */
let activeSourceIdx = 0;
let batchDepth = 0;
let microtaskScheduled = false;
const pendingEffects: ComputedNode[] = [];

const MAX_EFFECT_DEPTH = 100;
let effectDepth = 0;

// ---------------------------------------------------------------------------
// read / write / track
// ---------------------------------------------------------------------------

function readNode<T>(node: StateNode<T> | ComputedNode): T {
  if (node.fn !== null) {
    const c = node as ComputedNode;
    if (c.status !== STATUS_CLEAN) updateValue(c);
  }
  if (activeListener !== null && !activeListener.disposed) {
    track(node);
  }
  return node.value as T;
}

function peekNode<T>(node: StateNode<T> | ComputedNode): T {
  if (node.fn !== null) {
    const c = node as ComputedNode;
    if (c.status !== STATUS_CLEAN) updateValue(c);
  }
  return node.value as T;
}

function writeState<T>(node: StateNode<T>, value: T, equals: (a: T, b: T) => boolean): void {
  if (equals(node.value, value)) return;
  node.value = value;
  node.version++;
  if (node.observers !== null) {
    markDirty(node.observers);
    if (batchDepth === 0) scheduleFlush();
  }
}

function track(producer: AnyNode): void {
  const consumer = activeListener!;
  const idx = activeSourceIdx;
  const sources = consumer.sources;

  // Position-indexed reuse: if the slot at idx already points at the same
  // producer, just refresh the version snapshot. Common case for stable
  // dependency sets (most templates re-read the same signals each run).
  if (sources !== null && idx < sources.length) {
    const cur = sources[idx];
    if (cur === producer) {
      consumer.sourceVersions![idx] = producer.version;
      activeSourceIdx = idx + 1;
      return;
    }
    // Slot occupied by a different producer — swap.
    removeObserver(cur, consumer);
    sources[idx] = producer;
    consumer.sourceVersions![idx] = producer.version;
    addObserver(producer, consumer);
  } else {
    // Append fresh slot.
    if (sources === null) {
      consumer.sources = [producer];
      consumer.sourceVersions = [producer.version];
    } else {
      sources.push(producer);
      consumer.sourceVersions!.push(producer.version);
    }
    addObserver(producer, consumer);
  }
  activeSourceIdx = idx + 1;
}

function addObserver(producer: AnyNode, consumer: ComputedNode): void {
  if (producer.observers === null) producer.observers = [consumer];
  else producer.observers.push(consumer);
}

function removeObserver(producer: AnyNode, consumer: ComputedNode): void {
  const obs = producer.observers;
  if (obs === null) return;
  const i = obs.indexOf(consumer);
  if (i < 0) return;
  const last = obs.length - 1;
  if (i !== last) obs[i] = obs[last];
  obs.pop();
  if (obs.length === 0) producer.observers = null;
}

// ---------------------------------------------------------------------------
// dirty propagation
// ---------------------------------------------------------------------------

function markDirty(observers: ComputedNode[]): void {
  for (let i = 0; i < observers.length; i++) {
    const o = observers[i];
    if (o.status === STATUS_DIRTY) continue;
    o.status = STATUS_DIRTY;
    if (o.isEffect) pendingEffects.push(o);
    if (o.observers !== null) markCheck(o.observers);
  }
}

function markCheck(observers: ComputedNode[]): void {
  for (let i = 0; i < observers.length; i++) {
    const o = observers[i];
    if (o.status !== STATUS_CLEAN) continue;
    o.status = STATUS_CHECK;
    if (o.isEffect) pendingEffects.push(o);
    if (o.observers !== null) markCheck(o.observers);
  }
}

// ---------------------------------------------------------------------------
// updateValue — pull a node back to CLEAN
// ---------------------------------------------------------------------------

function updateValue(node: ComputedNode): void {
  if (node.disposed) {
    node.status = STATUS_CLEAN;
    return;
  }
  if (node.status === STATUS_CHECK) {
    // Walk sources; if any actually changed (source.version differs from our
    // snapshot), escalate to DIRTY. Otherwise we're unchanged and can stay
    // CLEAN without re-running fn().
    const sources = node.sources;
    if (sources !== null) {
      const versions = node.sourceVersions!;
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (src.fn !== null) {
          const sc = src as ComputedNode;
          if (sc.status !== STATUS_CLEAN) updateValue(sc);
        }
        if (src.version !== versions[i]) {
          node.status = STATUS_DIRTY;
          break;
        }
      }
    }
    if (node.status === STATUS_CHECK) {
      node.status = STATUS_CLEAN;
      return;
    }
  }
  runComputed(node);
}

function runComputed(node: ComputedNode): void {
  // Cleanup runs before fn re-evaluates, so the user's cleanup closure can
  // still see the values from the run that produced it.
  if (node.cleanup !== null) {
    const c = node.cleanup;
    node.cleanup = null;
    try {
      c();
    } catch (e) {
      console.error('[Purity] cleanup error:', e);
    }
  }
  if (node.disposed) {
    node.status = STATUS_CLEAN;
    return;
  }

  // Re-entrancy guard for effects only — pure compute() chains form a DAG
  // and are bounded by the graph, not by re-runs. Effects can be triggered
  // by their own writes; cap how deep that nesting can get before we assume
  // a feedback loop and bail.
  if (node.isEffect) {
    if (++effectDepth > MAX_EFFECT_DEPTH) {
      effectDepth = 0;
      throw new Error(
        '[Purity] Maximum effect depth exceeded. ' +
          'A watch/effect callback is likely modifying the signal it depends on.',
      );
    }
  }

  const prevListener = activeListener;
  const prevIdx = activeSourceIdx;
  activeListener = node;
  activeSourceIdx = 0;

  let nextValue: unknown;
  try {
    nextValue = node.fn();
  } finally {
    // Truncate stale source slots. Anything past activeSourceIdx is no
    // longer read by this fn — drop the producer→consumer link.
    const consumed = activeSourceIdx;
    const sources = node.sources;
    if (sources !== null && sources.length > consumed) {
      for (let i = consumed; i < sources.length; i++) {
        removeObserver(sources[i], node);
      }
      sources.length = consumed;
      node.sourceVersions!.length = consumed;
    }
    activeListener = prevListener;
    activeSourceIdx = prevIdx;
    if (node.isEffect) effectDepth--;
  }

  // Effect bodies may return a cleanup function; capture it and don't treat
  // it as a value (effects produce no observable value).
  if (node.isEffect) {
    if (typeof nextValue === 'function') {
      node.cleanup = nextValue as () => void;
    }
    nextValue = undefined;
  }

  const changed = !Object.is(node.value, nextValue);
  node.value = nextValue;
  node.status = STATUS_CLEAN;
  if (changed) {
    node.version++;
    // Direct observers reading us through the CHECK→CLEAN fast path were
    // optimistic; force them DIRTY now that we know our value moved.
    if (node.observers !== null) {
      const obs = node.observers;
      for (let i = 0; i < obs.length; i++) {
        if (obs[i].status === STATUS_CHECK) obs[i].status = STATUS_DIRTY;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

function scheduleFlush(): void {
  if (microtaskScheduled) return;
  microtaskScheduled = true;
  queueMicrotask(flush);
}

function flush(): void {
  microtaskScheduled = false;
  // Process effects FIFO. New effects pushed during flushing are picked up
  // in subsequent loop iterations of this same flush.
  let i = 0;
  while (i < pendingEffects.length) {
    const e = pendingEffects[i++];
    if (e.disposed || e.status === STATUS_CLEAN) continue;
    updateValue(e);
  }
  pendingEffects.length = 0;
}

// ---------------------------------------------------------------------------
// Public types & API
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
}

/** Cleanup function returned by watch(). Call to stop watching. */
export type Dispose = () => void;

const defaultEquals = Object.is;

// ---------------------------------------------------------------------------
// state(initial)
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
  const node: StateNode<T> = {
    fn: null,
    value: initial,
    version: 0,
    observers: null,
  };

  const accessor = ((...args: [T | ((current: T) => T)] | []): T => {
    if (args.length === 0) return readNode(node);
    const value = args[0];
    if (typeof value === 'function') {
      const next = (value as (current: T) => T)(node.value);
      writeState(node, next, defaultEquals);
      return next;
    }
    writeState(node, value as T, defaultEquals);
    return value as T;
  }) as StateAccessor<T>;

  // Avoid `bind()` and per-call closures: we can attach the property API
  // directly because every call routes through `node` already.
  (accessor as unknown as { get: () => T }).get = () => readNode(node);
  (accessor as unknown as { set: (v: T) => void }).set = (v: T) => {
    writeState(node, v, defaultEquals);
  };
  (accessor as unknown as { peek: () => T }).peek = () => node.value;

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
  const node: ComputedNode = {
    fn: fn as () => unknown,
    value: undefined,
    version: 0,
    status: STATUS_DIRTY,
    sources: null,
    sourceVersions: null,
    observers: null,
    cleanup: null,
    isEffect: false,
    disposed: false,
  };

  const accessor = (() => readNode<T>(node)) as ComputedAccessor<T>;
  (accessor as unknown as { get: () => T }).get = () => readNode<T>(node);
  (accessor as unknown as { peek: () => T }).peek = () => peekNode<T>(node);

  return accessor;
}

// ---------------------------------------------------------------------------
// Internal effect runner
// ---------------------------------------------------------------------------

function _effect(fn: () => undefined | Dispose): Dispose {
  const node: ComputedNode = {
    fn: fn as () => unknown,
    value: undefined,
    version: 0,
    status: STATUS_DIRTY,
    sources: null,
    sourceVersions: null,
    observers: null,
    cleanup: null,
    isEffect: true,
    disposed: false,
  };

  // Effects run their initial body eagerly (synchronous) — the templates
  // and tests rely on this to set up DOM bindings before the user code
  // continues.
  updateValue(node);

  const dispose = (): void => {
    if (node.disposed) return;
    node.disposed = true;
    if (node.cleanup !== null) {
      const c = node.cleanup;
      node.cleanup = null;
      try {
        c();
      } catch (e) {
        console.error('[Purity] cleanup error:', e);
      }
    }
    // Disconnect from each producer's observer list.
    const sources = node.sources;
    if (sources !== null) {
      for (let i = 0; i < sources.length; i++) removeObserver(sources[i], node);
      node.sources = null;
      node.sourceVersions = null;
    }
  };

  // Auto-register with the current component/render context so reactive
  // bindings created inside a template (or inside an each() entry, a
  // component, etc.) are torn down when that scope unmounts.
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(dispose);

  return dispose;
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

  let oldValues = new Array(len);
  let newValues = new Array(len);
  for (let i = 0; i < len; i++) oldValues[i] = sources[i]();

  let first = true;

  return _effect(() => {
    for (let i = 0; i < len; i++) newValues[i] = sources[i]();

    if (first) {
      first = false;
      const tmp = oldValues;
      oldValues = newValues;
      newValues = tmp;
      return;
    }

    const result = isArray ? cb(newValues, oldValues) : cb(newValues[0], oldValues[0]);

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
 * Batch multiple signal writes into a single flush. Effects only run once
 * after the batch.
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
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && pendingEffects.length > 0) scheduleFlush();
  }
}
