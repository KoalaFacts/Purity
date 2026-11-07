// store() — property-granular structured state (`@purityjs/core/store`,
// ADR 0055 property store). Reads go through a read-only proxy that tracks one
// version signal per (object, property) plus one structural signal per object
// for key sets (`in`, `Object.keys`, `for…in`, array length). Writes happen
// only inside `update(draft => …)`, which runs untracked inside one batch().
import { batch, type StateAccessor, state, untracked } from '@purityjs/signals';

/** Deep read-only view of a store value. */
export type StoreView<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly StoreView<U>[]
    : T extends Date | Map<unknown, unknown> | Set<unknown> | WeakMap<object, unknown> | RegExp
      ? T
      : T extends object
        ? { readonly [K in keyof T]: StoreView<T[K]> }
        : T;

/** Applies writes to a mutable draft of the store in one batch. */
export type StoreUpdate<T> = (fn: (draft: T) => void) => void;

const RAW = Symbol('purity.store.raw');
const KEYS = Symbol('purity.store.keys');

type Signals = Map<PropertyKey, StateAccessor<number>>;
const signals = new WeakMap<object, Signals>();
const views = new WeakMap<object, object>();
const drafts = new WeakMap<object, object>();

const isWrappable = (value: unknown): value is object => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return (
    value !== Object.prototype &&
    (proto === Object.prototype || proto === null || Array.isArray(value))
  );
};

const unwrap = (value: unknown): unknown =>
  (value !== null && typeof value === 'object' && (value as { [RAW]?: object })[RAW]) || value;

const signalFor = (target: object, key: PropertyKey): StateAccessor<number> => {
  let map = signals.get(target);
  if (!map) signals.set(target, (map = new Map()));
  let sig = map.get(key);
  if (!sig) map.set(key, (sig = state(0)));
  return sig;
};

const bump = (target: object, key: PropertyKey): void => {
  const sig = signals.get(target)?.get(key);
  if (sig) sig(sig.peek() + 1);
};

// Search arrays by plain value, so view and draft items (different proxies of
// the same object) are found: `d.list.indexOf(view.list[0])`.
const SEARCH = new Set<PropertyKey>(['indexOf', 'lastIndexOf', 'includes']);
const search = (target: unknown[], key: 'indexOf'): typeof Array.prototype.indexOf =>
  function (this: unknown[], item, ...rest) {
    // Read through the proxy so a view search tracks length and every index.
    for (let i = 0; i < this.length; i++) void this[i];
    // Elements may be stored proxies (`d.list = [...view.list]`): compare raw.
    return target.map(unwrap)[key](unwrap(item), ...rest);
  };

// Store proxies nested inside newly assigned objects (`d.list = [...view.list]`)
// are unwrapped on read. Values under non-writable, non-configurable properties
// (e.g. of frozen objects) are returned as they are: proxy invariants forbid a
// different value there.
const wrapIn = (
  target: object,
  key: PropertyKey,
  value: unknown,
  wrap: (value: object) => object,
): unknown => {
  const raw = unwrap(value);
  if (!isWrappable(raw)) return value;
  const desc = Object.getOwnPropertyDescriptor(target, key);
  return desc && desc.writable === false && !desc.configurable ? value : wrap(raw);
};

const readOnly = (): never => {
  throw new TypeError('[Purity] store views are read-only; write inside update(draft => …)');
};

const viewHandler: ProxyHandler<object> = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    if (Array.isArray(target) && SEARCH.has(key)) return search(target, key as 'indexOf');
    signalFor(target, key)();
    // The proxy is the receiver, so getters read tracked properties.
    return wrapIn(target, key, Reflect.get(target, key, receiver), view);
  },
  has(target, key) {
    if (key === RAW) return true;
    signalFor(target, KEYS)();
    return Reflect.has(target, key);
  },
  ownKeys(target) {
    signalFor(target, KEYS)();
    return Reflect.ownKeys(target);
  },
  set: readOnly,
  deleteProperty: readOnly,
  defineProperty: readOnly,
  setPrototypeOf: readOnly,
};

const draftHandler: ProxyHandler<object> = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    if (key === '__proto__') return Object.getPrototypeOf(target);
    if (Array.isArray(target) && SEARCH.has(key)) return search(target, key as 'indexOf');
    return wrapIn(target, key, Reflect.get(target, key, receiver), draft);
  },
  set(target, key, value, receiver) {
    if (key === '__proto__') {
      throw new TypeError('[Purity] store drafts cannot set __proto__');
    }
    const desc = Object.getOwnPropertyDescriptor(target, key);
    // Setters run with the draft as `this`, so their writes notify.
    if (desc?.set) return Reflect.set(target, key, value, receiver);
    const next = unwrap(value);
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const prev = unwrap((target as Record<PropertyKey, unknown>)[key]);
    const length = Array.isArray(target) ? target.length : 0;
    if (had && Object.is(prev, next)) return true;
    (target as Record<PropertyKey, unknown>)[key] = next;
    bump(target, key);
    if (Array.isArray(target)) {
      // Shrinking via `length` drops indices; growing via index adds them.
      for (let i = target.length; i < length; i++) bump(target, String(i));
      if (target.length !== length) {
        bump(target, 'length');
        bump(target, KEYS);
      } else if (!had) bump(target, KEYS);
    } else if (!had) bump(target, KEYS);
    return true;
  },
  defineProperty(target, key, desc) {
    if (key === '__proto__') return false;
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const ok = Reflect.defineProperty(target, key, desc);
    bump(target, key);
    if (!had) bump(target, KEYS);
    return ok;
  },
  deleteProperty(target, key) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) return true;
    delete (target as Record<PropertyKey, unknown>)[key];
    bump(target, key);
    bump(target, KEYS);
    return true;
  },
};

function view(target: object): object {
  let proxy = views.get(target);
  if (!proxy) views.set(target, (proxy = new Proxy(target, viewHandler)));
  return proxy;
}

function draft(target: object): object {
  let proxy = drafts.get(target);
  if (!proxy) drafts.set(target, (proxy = new Proxy(target, draftHandler)));
  return proxy;
}

/**
 * Create a property-granular store from a plain object or array.
 *
 * Returns `[view, update]`. Reading `view.a.b` inside `compute()`/`watch()`
 * or a template binding subscribes to that property only. Plain objects and
 * arrays are wrapped on read; other objects (Date, Map, class instances) are
 * returned as they are. The view is read-only: change it with
 * `update(draft => { draft.a.b = 1; draft.list.push(x); })`, which applies
 * every write in one batch and notifies only readers of changed properties
 * (equal writes, compared with `Object.is`, notify nobody).
 *
 * @example
 * ```ts
 * const [form, setForm] = store({ name: '', address: { city: '' } });
 * html`<input :value=${() => form.address.city}
 *   @input=${(e) => setForm((d) => { d.address.city = e.target.value; })} />`;
 * ```
 */
export function store<T extends object>(initial: T): [view: StoreView<T>, update: StoreUpdate<T>] {
  if (!isWrappable(initial)) {
    throw new TypeError('[Purity] store() needs a plain object or array');
  }
  const root = unwrap(initial) as T;
  return [
    view(root) as StoreView<T>,
    (fn) => {
      batch(() => untracked(() => fn(draft(root) as T)));
    },
  ];
}
