// ---------------------------------------------------------------------------
// Purity async transactions (`@purityjs/core/transaction`, ADR 0059)
//
// transaction(fn) holds authoritative state writes made through `tx.set()`
// until the async work settles, then applies them in one batch, so readers
// never see half of a multi-signal update. `tx.optimistic()` shows a
// tentative value at once and removes it exactly once when the transaction
// settles (commit, rejection or owner disposal).
// ---------------------------------------------------------------------------

import { batch, getCurrentContext, state, type StateAccessor, untracked } from '@purityjs/signals';

/** Passed to the {@link transaction} callback. */
export interface Transaction {
  /** Stage an authoritative write, applied with the others when `fn` resolves. */
  set<T>(target: StateAccessor<T>, value: T): void;
  /** Show `value` now; it is removed exactly once when the transaction settles. */
  optimistic<T>(target: StateAccessor<T>, value: T): void;
  /** Aborted when the owner that started the transaction is disposed first. */
  signal: AbortSignal;
}

interface Layer {
  tx: object;
  value: unknown;
}

interface Overlay {
  /** Authoritative value under the tentative layers. */
  base: unknown;
  /** Value this module last wrote, to detect writes made around it. */
  shown: unknown;
  layers: Layer[];
}

type Target = StateAccessor<any>;

const overlays = new Map<Target, Overlay>();
const running = state(0);

/**
 * Number of transactions that have started and not yet settled (tracked).
 * It drops in the same batch as the settling transaction's commit, so a
 * reader never sees the count fall before the committed values.
 *
 * ```ts
 * html`<button ?disabled=${() => pendingTransactions() > 0}>Save</button>`;
 * ```
 */
export const pendingTransactions = (): number => running();

// A write made directly to an overlaid signal becomes its new base.
const adopt = (target: Target, entry: Overlay): void => {
  const current = target.peek();
  if (!Object.is(current, entry.shown)) entry.base = current;
};

const show = (target: Target, entry: Overlay): void => {
  const n = entry.layers.length;
  entry.shown = n ? entry.layers[n - 1].value : entry.base;
  target.set(entry.shown);
};

const write = (target: Target, value: unknown): void => {
  const entry = overlays.get(target);
  if (entry) {
    adopt(target, entry);
    entry.base = value;
  } else target.set(value);
};

const drop = (tx: object, targets: Target[] | null): void => {
  if (!targets) return;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const entry = overlays.get(target);
    if (!entry) continue;
    adopt(target, entry);
    entry.layers = entry.layers.filter((layer) => layer.tx !== tx);
    if (entry.layers.length) show(target, entry);
    else {
      overlays.delete(target);
      target.set(entry.base);
    }
  }
};

/**
 * Run async work whose state writes become visible together. Writes staged
 * with `tx.set()` are applied in one batch when `fn` resolves and discarded
 * when it rejects; values shown with `tx.optimistic()` are removed when it
 * settles either way. Called synchronously inside an owner (component setup,
 * a render, a `watch()` run), the transaction is aborted when that owner is
 * disposed or the watch re-runs: its writes are discarded, its tentative
 * values removed and the returned promise rejects with the abort reason.
 * Event handlers run outside any owner, so their transactions always settle.
 *
 * ```ts
 * await transaction(async (tx) => {
 *   tx.optimistic(title, draft);           // shown now
 *   const saved = await save(draft);
 *   tx.set(title, saved.title);            // both applied together
 *   tx.set(updatedAt, saved.updatedAt);
 * });
 * ```
 */
export function transaction<R>(fn: (tx: Transaction) => R | PromiseLike<R>): Promise<R> {
  const controller = new AbortController();
  const key = {};
  let staged: Map<Target, unknown> | null = null;
  let shownOn: Target[] | null = null;
  let settled = false;
  let release: (() => void) | null = null;

  const assertOpen = (): void => {
    if (settled) throw new Error('[Purity] transaction already settled');
  };

  const finish = (commit: boolean): boolean => {
    if (settled) return false;
    settled = true;
    batch(() => {
      running.set(running.peek() - 1);
      drop(key, shownOn);
      if (commit && staged) for (const [target, value] of staged) write(target, value);
    });
    staged = shownOn = null;
    release?.();
    return true;
  };

  const tx: Transaction = {
    set(target, value) {
      assertOpen();
      (staged ??= new Map()).set(target, value);
    },
    optimistic(target, value) {
      assertOpen();
      let entry = overlays.get(target);
      if (entry) adopt(target, entry);
      else overlays.set(target, (entry = { base: target.peek(), shown: undefined, layers: [] }));
      entry.layers.push({ tx: key, value });
      if (!(shownOn ??= []).includes(target)) shownOn.push(target);
      show(target, entry);
    },
    signal: controller.signal,
  };

  running.set(running.peek() + 1);
  return new Promise<R>((resolve, reject) => {
    const ctx = getCurrentContext();
    if (ctx) {
      const onDispose = (): void => {
        release = null;
        if (!settled) {
          controller.abort();
          finish(false);
          reject(controller.signal.reason);
        }
      };
      (ctx.disposers ??= []).push(onDispose);
      // Settled transactions leave no disposer behind on long-lived owners.
      release = () => {
        const list = ctx.disposers;
        const i = list ? list.indexOf(onDispose) : -1;
        if (i >= 0) list!.splice(i, 1);
      };
    }
    let result: R | PromiseLike<R>;
    try {
      result = untracked(() => fn(tx));
    } catch (err) {
      finish(false);
      reject(err);
      return;
    }
    Promise.resolve(result).then(
      (value) => {
        if (finish(true)) resolve(value);
      },
      (err: unknown) => {
        if (finish(false)) reject(err);
      },
    );
  });
}
