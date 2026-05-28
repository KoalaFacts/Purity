// ---------------------------------------------------------------------------
// mountIslands(views) — client-side island hydrator. ADR 0038 Phase 2.
//
// Walks the document for `<purity-island data-pi-id="N">` wrappers emitted
// by `island()` during SSR, looks up each by 1-based ID against the
// supplied view array, and schedules `hydrate(root, view)` on the wrapper
// once the per-island trigger fires.
//
// Triggers shipped in Phase 2:
//   * 'load'    — resolves on the next microtask (default).
//   * 'visible' — resolves when the wrapper enters the viewport, via
//                 IntersectionObserver. Falls back to 'load' when the
//                 platform lacks IntersectionObserver.
//
// 'idle', 'interact', and `media:…` are stubbed to 'load' here; Phase 4
// fills them in with real implementations. The fallback is intentional —
// shipping the trigger surface today lets users author against the final
// API; the deferred semantics arrive without an API change.
//
// Cross-island state is NOT addressed by this runtime — each island gets
// its own signal graph. Use the URL, `persist()`-style storage, or
// server round-trips for shared state. See ADR 0038.
// ---------------------------------------------------------------------------

import { hydrate } from './component.ts';
import { getIslandBrand, type IslandTrigger } from './island.ts';

const WRAPPER_SELECTOR = 'purity-island[data-pi-id]';

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
 * import { Counter } from './counter.ts';
 * import { Like } from './like.ts';
 *
 * mountIslands([Counter, Like]);
 * ```
 *
 * @remarks
 * Wrappers whose `data-pi-id` is out of range for `views` are skipped
 * with a `console.warn`. This is the symptom of a mismatched manifest
 * between the SSR render and the client entry — usually a re-ordered
 * import.
 */
export function mountIslands(
  views: ReadonlyArray<(...args: never[]) => unknown>,
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
    const view = views[id - 1];
    if (typeof view !== 'function') {
      console.warn(
        `[Purity] mountIslands: no view at index ${id - 1} for <purity-island data-pi-id="${id}"> — ` +
          'check that the client manifest matches the SSR render order.',
      );
      continue;
    }
    const trigger = readTrigger(el);
    scheduleHydration(el, view, trigger, () => {
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
  view: (...args: never[]) => unknown,
  trigger: IslandTrigger,
  done: () => void,
): void {
  const run = (): void => {
    // Custom-element-rooted islands: the SSR-emitted element auto-upgrades
    // the moment its class is registered (which happened when the user
    // imported the view module), so hydration ran via DSD + Custom
    // Element upgrade before mountIslands() saw the wrapper. Calling
    // `hydrate(wrapper, view)` here would re-execute the view's factory,
    // which returns a fresh Node — and hydrate()'s non-deferred branch
    // (component.ts:369) would lossily replace the already-upgraded
    // SSR element. So we detect and skip.
    const first = el.firstElementChild;
    const tag = first?.tagName.toLowerCase();
    if (
      tag &&
      tag.includes('-') &&
      typeof customElements !== 'undefined' &&
      customElements.get(tag)
    ) {
      done();
      return;
    }
    // Prefer the brand's inner view when present — `view` may be the
    // island wrapper itself, in which case calling it on the client is
    // identical to the inner view (the SSR branch only fires under a
    // pushed SSRRenderContext, which the client never has). Reading the
    // brand removes the extra closure hop.
    const brand = getIslandBrand(view);
    const target = (brand?.view ?? view) as (...args: never[]) => unknown;
    try {
      hydrate(el, target as Parameters<typeof hydrate>[1]);
    } catch (err) {
      console.error('[Purity] mountIslands: hydrate() threw for island', el, err);
    }
    done();
  };
  switch (trigger) {
    case 'visible':
      waitForVisible(el, run);
      return;
    case 'load':
    case 'idle': // Phase 4
    case 'interact': // Phase 4
    default: // media:… — Phase 4
      waitForLoad(run);
      return;
  }
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
