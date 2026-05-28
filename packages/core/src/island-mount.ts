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
   * Called once per island after `hydrate()` returns. Receives the island
   * ID (1-based, matching the `data-pi-id` attribute) and the wrapper
   * element. Useful for instrumentation in tests.
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
  if (raw.startsWith('media:')) return raw as `media:${string}`;
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
  const run = (): void => {
    // Custom-element-rooted islands: the SSR-emitted element auto-upgrades
    // the moment its class is registered (which happens at import time —
    // either at module init for an eager entry, or when the lazy chunk
    // resolves below). Either way, by the time we'd call hydrate() the
    // CE has either already done it via DSD or will once the class
    // arrives. Calling `hydrate(wrapper, view)` would re-execute the
    // view's factory, which returns a fresh Node — and hydrate()'s
    // non-deferred branch (component.ts:369) would lossily replace the
    // already-upgraded SSR element. So we detect and skip.
    const first = el.firstElementChild;
    const tag = first?.tagName.toLowerCase();
    const isCustomElementRoot =
      !!tag &&
      tag.includes('-') &&
      typeof customElements !== 'undefined' &&
      !!customElements.get(tag);

    resolveEntry(entry, id)
      .then((view) => {
        if (!view) {
          done();
          return;
        }
        if (isCustomElementRoot) {
          // Even for lazy entries: importing the chunk registered the
          // class, which upgrades the SSR element synchronously. Nothing
          // for us to do beyond that.
          done();
          return;
        }
        try {
          hydrate(el, view as Parameters<typeof hydrate>[1]);
        } catch (err) {
          console.error('[Purity] mountIslands: hydrate() threw for island', el, err);
        }
        done();
      })
      .catch((err) => {
        console.error(`[Purity] mountIslands: failed to resolve island ${id}:`, err);
        done();
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
      // media:(query) — string-literal match exhausted above; anything
      // else here is malformed and readTrigger() will have already
      // warned + downgraded. We re-check the string defensively.
      if (typeof trigger === 'string' && (trigger as string).startsWith('media:')) {
        waitForMedia((trigger as string).slice('media:'.length), run);
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
    if (typeof mod.default === 'function') return mod.default as View;
    // Look for a single function export — covers `export const X = …`.
    let candidate: View | null = null;
    let count = 0;
    for (const k in mod) {
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
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: object) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    ric(run, { timeout: 2000 });
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
  const mm = (globalThis as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
  if (typeof mm !== 'function') {
    waitForLoad(run);
    return;
  }
  let mql: MediaQueryList;
  try {
    mql = mm(query);
  } catch (err) {
    console.warn(`[Purity] mountIslands: invalid media query ${JSON.stringify(query)}:`, err);
    waitForLoad(run);
    return;
  }
  if (mql.matches) {
    run();
    return;
  }
  const handler = (e: MediaQueryListEvent): void => {
    if (!e.matches) return;
    mql.removeEventListener('change', handler);
    run();
  };
  mql.addEventListener('change', handler);
}
