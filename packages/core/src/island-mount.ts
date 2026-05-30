// ---------------------------------------------------------------------------
// mountIslands(views) — client-side island hydrator. ADR 0038 Phases 2 + 3.
//
// Walks the document for `<purity-island data-pi-id="N">` wrappers emitted
// by `island()` during SSR, looks up each by 1-based ID against the
// supplied view array, and schedules `hydrate(root, view)` on the wrapper
// once the per-island trigger fires.
//
// Phase 3 (this file) adds lazy view support: an entry may be either
//   * an eager view function — `Counter`
//   * a thunk returning a Promise — `() => import('./counter.ts').then(m => m.Counter)`
//   * a thunk returning a module-namespace-like value — `() => import('./counter.ts')`
//     (we look for `.default` or for a single function export when the
//     thunk returns an object). When the thunk returns a function
//     directly, we use it as-is.
// Lazy entries let users opt into Rollup's standard dynamic-import chunk
// splitting: each island's view + its transitive deps land in their own
// chunk, the shell ships only `mountIslands` + the import thunks, and the
// trigger semantics decide *when* the chunk loads. Content pages with
// trigger='visible' islands pay nothing for the island's code until the
// user scrolls.
//
// Triggers (all shipped after Phase 4):
//   * 'load'      — resolves on the next microtask (default).
//   * 'idle'      — resolves inside requestIdleCallback; falls back to
//                   setTimeout when the host lacks the API (Safari).
//   * 'visible'   — resolves when the wrapper enters the viewport, via
//                   IntersectionObserver. Falls back to 'load' when the
//                   platform lacks IntersectionObserver.
//   * 'interact'  — resolves on first pointerdown / focusin / keydown
//                   inside the wrapper. Listeners are { once: true,
//                   capture: true } and all unhook themselves at first
//                   fire so a slow click can still reach its real
//                   handler after hydration completes.
//   * media:(…)   — resolves when the media query matches. If already
//                   matched at mount time, hydrates immediately; else
//                   listens for change.
//
// Cross-island state is NOT addressed by this runtime — each island gets
// its own signal graph. Use the URL, `persist()`-style storage, or
// server round-trips for shared state. See ADR 0038.
// ---------------------------------------------------------------------------

import { hydrate } from './component.ts';
import { getIslandBrand, type IslandTrigger } from './island.ts';

const WRAPPER_SELECTOR = 'purity-island[data-pi-id]';

/** A view function — what `island(...)` wraps. */
type View = (...args: never[]) => unknown;

/**
 * A lazy view: a thunk that resolves to a view (or to a module
 * namespace containing one). Use this to dynamic-import an island's
 * code so its bytes don't ship with the shell.
 *
 * @example
 * ```ts
 * mountIslands([
 *   () => import('./counter.ts').then((m) => m.Counter),
 *   () => import('./like.ts'),
 *   Greeting,
 * ]);
 * ```
 */
export type LazyView = () => View | Promise<View | ModuleLike>;

/** Module-namespace-like value we can unwrap into a view. */
interface ModuleLike {
  default?: unknown;
  [name: string]: unknown;
}

/** Either form accepted by {@link mountIslands}. */
export type IslandEntry = View | LazyView;

/** Per-render options accepted by {@link mountIslands}. */
export interface MountIslandsOptions {
  /**
   * Root element to scan for `<purity-island>` wrappers. Defaults to
   * `document.documentElement`. Useful for tests and for multi-island
   * shells where only a subset of the DOM should be considered.
   */
  root?: ParentNode;
  /**
   * Called once per island after the trigger fires and the resolution +
   * hydration attempt completes. Fires for both successful and
   * skipped/errored islands (a thrown hydrate() is caught + logged
   * before this fires). Receives the island ID (1-based, matching the
   * `data-pi-id` attribute) and the wrapper element. Useful for
   * instrumentation in tests.
   */
  onMount?: (id: number, root: Element) => void;
}

/**
 * Hydrate every `<purity-island>` wrapper in the document, scheduling
 * each on the trigger that was recorded in its `data-pi-trigger`
 * attribute. The `views` array must be in the same order the islands
 * were rendered on the server (the first SSR-encountered island is
 * `views[0]`, the second is `views[1]`, etc).
 *
 * @example
 * ```ts
 * // entry.client.ts
 * import { mountIslands } from '@purityjs/core';
 *
 * // Eager: views ship with the shell.
 * import { Counter } from './counter.ts';
 * mountIslands([Counter]);
 *
 * // Lazy: each island ships in its own dynamic-import chunk.
 * mountIslands([
 *   () => import('./counter.ts').then((m) => m.Counter),
 *   () => import('./like.ts'),
 * ]);
 * ```
 *
 * @remarks
 * Wrappers whose `data-pi-id` is out of range for `views` are skipped
 * with a `console.warn`. This is the symptom of a mismatched manifest
 * between the SSR render and the client entry — usually a re-ordered
 * import.
 */
// Track which wrappers we've already scheduled hydration for. WeakSet
// so wrappers removed from the DOM are auto-cleaned. Per-call guards
// (e.g. mountIslands called twice during HMR or by user error) would
// otherwise stack listeners on `interact` islands, double-observe
// `visible` islands, and run `done()`/`onMount` twice each.
const hydrated = new WeakSet<Element>();

export function mountIslands(
  views: ReadonlyArray<IslandEntry>,
  options: MountIslandsOptions = {},
): void {
  const root = options.root ?? globalThis.document?.documentElement;
  if (!root) return;
  const onMount = options.onMount;
  const wrappers = root.querySelectorAll(WRAPPER_SELECTOR);
  for (let i = 0; i < wrappers.length; i++) {
    const el = wrappers[i] as HTMLElement;
    // Idempotency: a second mountIslands() call (HMR boot, user error,
    // a manifest-scan in a parent shell that also covers a nested
    // wrapper) must NOT re-arm hydration for an already-scheduled
    // wrapper. Without this guard, `interact` islands accumulate
    // listeners and `load` islands double-hydrate.
    if (hydrated.has(el)) continue;
    hydrated.add(el);
    const rawId = el.getAttribute('data-pi-id');
    const id = rawId != null ? Number(rawId) : NaN;
    if (!Number.isInteger(id) || id < 1) {
      console.warn(
        `[Purity] mountIslands: skipping <purity-island> with invalid data-pi-id=${JSON.stringify(rawId)}`,
      );
      continue;
    }
    const entry = views[id - 1];
    if (typeof entry !== 'function') {
      console.warn(
        `[Purity] mountIslands: no view at index ${id - 1} for <purity-island data-pi-id="${id}"> — ` +
          'check that the client manifest matches the SSR render order.',
      );
      continue;
    }
    const trigger = readTrigger(el);
    scheduleHydration(el, entry, trigger, id, () => {
      if (onMount) onMount(id, el);
    });
  }
}

function readTrigger(el: Element): IslandTrigger {
  const raw = el.getAttribute('data-pi-trigger');
  if (raw == null || raw === '') return 'load';
  if (raw === 'load' || raw === 'idle' || raw === 'visible' || raw === 'interact') return raw;
  // Require a non-empty media query suffix — mirrors `normalizeTrigger`
  // in island.ts, so a tampered `data-pi-trigger="media:"` (empty
  // query) can't reach `matchMedia('')` via this client path.
  if (raw.startsWith('media:') && raw.length > 'media:'.length) {
    return raw as `media:${string}`;
  }
  console.warn(
    `[Purity] mountIslands: unknown data-pi-trigger=${JSON.stringify(raw)}, falling back to 'load'.`,
  );
  return 'load';
}

function scheduleHydration(
  el: HTMLElement,
  entry: IslandEntry,
  trigger: IslandTrigger,
  id: number,
  done: () => void,
): void {
  // `done()` is user-supplied (onMount instrumentation). Isolate it so a
  // throwing onMount doesn't surface as a "failed to resolve island"
  // false positive via the outer `.catch`, and so it can't kill the
  // hydration pipeline for *other* islands sharing the same tick.
  const safeDone = (): void => {
    try {
      done();
    } catch (err) {
      console.error(`[Purity] mountIslands: onMount threw for island ${id}:`, err);
    }
  };
  const run = (): void => {
    resolveEntry(entry, id)
      .then((view) => {
        if (!view) {
          safeDone();
          return;
        }
        // Custom-element-rooted islands: the SSR-emitted element
        // auto-upgrades the moment its class is registered. For lazy
        // entries, registration happens during the `await import(...)`
        // above — so the CE check MUST run after resolveEntry resolves,
        // not before. Otherwise `customElements.get(tag)` returns
        // undefined for lazy CE-rooted islands and we'd fall through to
        // hydrate(el, view), which moves the just-upgraded CE through a
        // DocumentFragment and triggers disconnect/reconnect — double
        // hydration on an already-hydrated element.
        const first = el.firstElementChild;
        const tag = first?.tagName.toLowerCase();
        if (
          tag &&
          tag.includes('-') &&
          typeof customElements !== 'undefined' &&
          customElements.get(tag)
        ) {
          safeDone();
          return;
        }
        try {
          hydrate(el, view as Parameters<typeof hydrate>[1]);
        } catch (err) {
          console.error('[Purity] mountIslands: hydrate() threw for island', el, err);
        }
        safeDone();
      })
      .catch((err) => {
        console.error(`[Purity] mountIslands: failed to resolve island ${id}:`, err);
        safeDone();
      });
  };
  switch (trigger) {
    case 'visible':
      waitForVisible(el, run);
      return;
    case 'idle':
      waitForIdle(run);
      return;
    case 'interact':
      waitForInteract(el, run);
      return;
    case 'load':
      waitForLoad(run);
      return;
    default: {
      // media:(query) — `IslandTrigger` is string-only and the literal
      // values are exhausted above, so the remaining shape is the
      // template-literal `media:${string}`.
      if (trigger.startsWith('media:')) {
        waitForMedia(trigger.slice('media:'.length), run);
        return;
      }
      waitForLoad(run);
      return;
    }
  }
}

async function resolveEntry(entry: IslandEntry, id: number): Promise<View | null> {
  // Eager branded view (`island(component(...))`): use the brand's inner
  // view. Branded views skip the thunk-call entirely, which is the
  // canonical eager shape — `mountIslands([Counter])`.
  const brand = getIslandBrand(entry as View);
  if (brand) return brand.view as View;
  // Otherwise: treat as a lazy thunk. The thunk is expected to return
  // a Promise (dynamic-import shape: `() => import('./x.ts')`); a
  // synchronously-returning function is treated as an inline view for
  // convenience. We never invoke arbitrary user functions whose return
  // shape we can't predict.
  let produced: unknown;
  try {
    produced = (entry as LazyView)();
  } catch (err) {
    console.error(`[Purity] mountIslands: island ${id} thunk threw:`, err);
    return null;
  }
  if (produced != null && typeof (produced as { then?: unknown }).then === 'function') {
    let resolved: unknown;
    try {
      resolved = await (produced as Promise<unknown>);
    } catch (err) {
      console.error(`[Purity] mountIslands: island ${id} import rejected:`, err);
      return null;
    }
    return unwrapModule(resolved, id);
  }
  return unwrapModule(produced, id);
}

function unwrapModule(value: unknown, id: number): View | null {
  if (typeof value === 'function') return value as View;
  if (value && typeof value === 'object') {
    const mod = value as ModuleLike;
    // Use hasOwnProperty so a prototype-polluted
    // `Object.prototype.default = badFn` can't hijack module resolution
    // for plain-object thunk returns (real ES module namespaces are
    // null-proto, but synchronous test fixtures and user-supplied
    // factories often return plain objects).
    if (Object.prototype.hasOwnProperty.call(mod, 'default') && typeof mod.default === 'function') {
      return mod.default as View;
    }
    // Look for a single function own-export — covers `export const X = …`.
    // `Object.keys` skips inherited + non-enumerable keys, which keeps a
    // patched prototype from contributing a phantom function export and
    // making the count appear to be 1.
    let candidate: View | null = null;
    let count = 0;
    const keys = Object.keys(mod);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === 'default') continue;
      const v = mod[k];
      if (typeof v === 'function') {
        candidate = v as View;
        count++;
      }
    }
    if (count === 1 && candidate) return candidate;
    console.warn(
      `[Purity] mountIslands: island ${id} resolved to a module with ${count} function exports; ` +
        'expected exactly one, or a `default` export. Returning null.',
    );
    return null;
  }
  console.warn(
    `[Purity] mountIslands: island ${id} resolved to ${typeof value}; expected a function or module.`,
  );
  return null;
}

function waitForLoad(run: () => void): void {
  // Defer to the next microtask so user code that calls mountIslands()
  // synchronously during module init still sees the document settle
  // before hydration begins. Mirrors how `mount()` posts mounted-hooks.
  queueMicrotask(run);
}

function waitForVisible(el: Element, run: () => void): void {
  const Ctor = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  if (typeof Ctor !== 'function') {
    // No platform support — degrade to immediate. Real fallback for older
    // platforms is out of scope; targeting evergreen.
    waitForLoad(run);
    return;
  }
  const obs = new Ctor((entries, observer) => {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) {
        observer.disconnect();
        run();
        return;
      }
    }
  });
  obs.observe(el);
}

function waitForIdle(run: () => void): void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, opts?: object) => number };
  const ric = g.requestIdleCallback;
  if (typeof ric === 'function') {
    // Invoke via `.call(g, ...)` so real browsers' `requestIdleCallback`
    // (which requires `this === window`) doesn't throw
    // "Illegal invocation" when we cached the function reference.
    ric.call(g, run, { timeout: 2000 });
    return;
  }
  // Safari pre-17 lacks rIC. setTimeout(…, 1) is a close-enough proxy:
  // gives the parser/painter a beat before running.
  setTimeout(run, 1);
}

function waitForInteract(el: Element, run: () => void): void {
  const events = ['pointerdown', 'focusin', 'keydown'] as const;
  // Re-entrant guard — once one event fires we tear the others down to
  // avoid double hydration if two events arrive in the same tick.
  let fired = false;
  const handler = (): void => {
    if (fired) return;
    fired = true;
    for (let i = 0; i < events.length; i++) {
      el.removeEventListener(events[i], handler, true);
    }
    run();
  };
  for (let i = 0; i < events.length; i++) {
    el.addEventListener(events[i], handler, { capture: true });
  }
}

function waitForMedia(query: string, run: () => void): void {
  const g = globalThis as { matchMedia?: (q: string) => MediaQueryList };
  const mm = g.matchMedia;
  if (typeof mm !== 'function') {
    waitForLoad(run);
    return;
  }
  let mql: MediaQueryList;
  try {
    // `.call(g, ...)` so real-browser `matchMedia` (which requires
    // `this === window`) doesn't throw "Illegal invocation" when the
    // function reference is detached from the global.
    mql = mm.call(g, query);
  } catch (err) {
    console.warn(`[Purity] mountIslands: invalid media query ${JSON.stringify(query)}:`, err);
    waitForLoad(run);
    return;
  }
  if (mql.matches) {
    run();
    return;
  }
  // Re-entrant guard: if `change` fires twice in the same tick (a
  // browser quirk we've seen on focus/orientation flips) the listener
  // body still only runs `run()` once. Without this, a slow
  // resolveEntry path could hand the same wrapper to `hydrate()` twice
  // before `removeEventListener` took effect.
  let fired = false;
  const handler = (e: MediaQueryListEvent): void => {
    if (fired || !e.matches) return;
    fired = true;
    mql.removeEventListener('change', handler);
    run();
  };
  mql.addEventListener('change', handler);
}
