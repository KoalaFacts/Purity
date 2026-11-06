// store() — property-granular structured state (`@purityjs/core/store`,
// ADR 0054 property store). Reads go through a read-only proxy that tracks one
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
  return proto === Object.prototype || proto === null || Array.isArray(value);
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

const readOnly = (): never => {
  throw new TypeError('[Purity] store views are read-only; write inside update(draft => …)');
};

const viewHandler: ProxyHandler<object> = {
  get(target, key) {
    if (key === RAW) return target;
    if (typeof key !== 'symbol') signalFor(target, key)();
    const value = Reflect.get(target, key);
    return isWrappable(value) ? view(value) : value;
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
  get(target, key) {
    if (key === RAW) return target;
    const value = Reflect.get(target, key);
    return isWrappable(value) ? draft(value) : value;
  },
  set(target, key, value) {
    const next = unwrap(value);
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const prev = (target as Record<PropertyKey, unknown>)[key];
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
