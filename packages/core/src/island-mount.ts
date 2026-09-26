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
//   * 'interact'  — starts on first pointerdown / focusin / keydown.
//                   A click or form submit arriving before hydration
//                   finishes is held and activated once afterward.
//   * media:(…)   — resolves when the media query matches. If already
//                   matched at mount time, hydrates immediately; else
//                   listens for change.
//
// Cross-island state is NOT addressed by this runtime — each island gets
// its own signal graph. Use the URL, `persist()`-style storage, or
// server round-trips for shared state. See ADR 0038.
// ---------------------------------------------------------------------------

import { hydrate } from './component.ts';
import { getIslandBrand, ISLAND_TRIGGERS, type IslandTrigger } from './island.ts';

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
  // Bug #14: reference the SAME allow-list `island.ts` uses for SSR
  // normalisation. Pre-fix, both sides duplicated the literal list — a
  // change on one side silently moved the security boundary. Importing
  // ISLAND_TRIGGERS makes drift impossible: a new trigger added to the
  // server allow-list is automatically honoured on the client.
  if (ISLAND_TRIGGERS.has(raw)) return raw as IslandTrigger;
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
  const run = (onSettled?: () => void): void => {
    const finish = (): void => {
      if (onSettled) {
        try {
          onSettled();
        } catch (err) {
          console.error(`[Purity] mountIslands: interaction replay threw for island ${id}:`, err);
        }
      }
      safeDone();
    };
    resolveEntry(entry, id)
      .then((view) => {
        if (!view) {
          finish();
          return;
        }
        // A registered custom element may already have rendered itself on
        // upgrade. Purity elements with DSD instead wait for their parent
        // to bind typed props, so they still need hydrate(el, view). That
        // path inflates in place and then hydrates the shadow tree.
        // Check after the import so the element has already upgraded.
        const first = el.firstElementChild;
        const tag = first?.tagName.toLowerCase();
        if (
          tag &&
          tag.includes('-') &&
          typeof customElements !== 'undefined' &&
          customElements.get(tag) &&
          (first as Element & { _pendingSSRHydration?: boolean })._pendingSSRHydration !== true
        ) {
          finish();
          return;
        }
        try {
          hydrate(el, view as Parameters<typeof hydrate>[1]);
        } catch (err) {
          console.error('[Purity] mountIslands: hydrate() threw for island', el, err);
        }
        finish();
      })
      .catch((err) => {
        console.error(`[Purity] mountIslands: failed to resolve island ${id}:`, err);
        finish();
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
  // Re-entrancy guard shared by the IO callback and the parent-detach
  // watcher below: whichever wins races to fire still runs disposal once.
  let fired = false;
  let mo: MutationObserver | null = null;
  // SSR wrappers use display:contents and have no intersection box. Observe
  // their rendered children so scrolling to a visible island starts loading.
  const targets =
    el instanceof HTMLElement && el.style.display === 'contents' ? Array.from(el.children) : [el];
  if (targets.length === 0) {
    waitForLoad(run);
    return;
  }
  const obs = new Ctor((entries, observer) => {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) {
        if (fired) return;
        fired = true;
        observer.disconnect();
        if (mo) mo.disconnect();
        run();
        return;
      }
    }
  });
  for (let i = 0; i < targets.length; i++) obs.observe(targets[i]);

  // Bug #5: without parent-detach detection, a `<purity-island>` removed
  // from the DOM before it intersects leaks the IntersectionObserver
  // target — the observer stays armed and the wrapper can't be GC'd.
  // Watch the parent's childList; when our wrapper goes missing, tear
  // the IO down. Use the parent (not the element itself) because once an
  // element is detached its own MutationObserver fires nothing useful.
  // If there is no parent (mount-before-attach), skip the watcher — the
  // GC pressure isn't there until the element has lived in a tree.
  const MO = (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
  const parent = el.parentNode;
  if (typeof MO === 'function' && parent) {
    mo = new MO(() => {
      // Cheap identity check on every mutation batch beats walking the
      // records — we only care that the wrapper is still parented here.
      if (el.parentNode !== parent) {
        if (fired) return;
        fired = true;
        for (let i = 0; i < targets.length; i++) obs.unobserve(targets[i]);
        obs.disconnect();
        if (mo) mo.disconnect();
      }
    });
    mo.observe(parent, { childList: true });
  }
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

function interactionTarget(event: Event, island: Element): Element | null {
  const path = event.composedPath();
  for (let i = 0; i < path.length && path[i] !== island; i++) {
    if (path[i] instanceof Element) return path[i] as Element;
  }
  return null;
}

function remainsInIsland(target: Node, island: Element): boolean {
  let node: Node | null = target;
  while (node) {
    if (node === island) return true;
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return false;
}

interface InteractionPathStep {
  ordinal: number;
  tagName: string;
  shadow: boolean;
}

// Hydration may replace an SSR node (including a DSD custom element). Keep
// its element-only path so the first activation can reach the matching live
// control after hydration. Abort when a matching tag/ordinal is missing.
function interactionPath(target: Element, island: Element): InteractionPathStep[] | null {
  const steps: InteractionPathStep[] = [];
  let node: Element = target;
  while (node !== island) {
    const parent = node.parentNode;
    if (!(parent instanceof Element) && !(parent instanceof ShadowRoot)) return null;
    let ordinal = 0;
    for (
      let sibling = node.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.tagName === node.tagName) ordinal++;
    }
    steps.push({ ordinal, tagName: node.tagName, shadow: parent instanceof ShadowRoot });
    node = parent instanceof ShadowRoot ? parent.host : parent;
  }
  return steps.reverse();
}

function liveInteractionTarget(
  original: Element,
  island: Element,
  path: InteractionPathStep[] | null,
): Element | null {
  if (original.isConnected && remainsInIsland(original, island)) return original;
  if (!path || !island.isConnected) return null;
  let node = island;
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    const parent = step.shadow ? node.shadowRoot : node;
    if (!parent) return null;
    let next: Element | null = null;
    let ordinal = 0;
    for (let j = 0; j < parent.children.length; j++) {
      const candidate = parent.children.item(j);
      if (candidate?.tagName !== step.tagName) continue;
      if (ordinal++ === step.ordinal) {
        next = candidate;
        break;
      }
    }
    if (!next) return null;
    node = next;
  }
  return node;
}

function hasActivationRole(event: Event, island: Element, key: string): boolean {
  const path = event.composedPath();
  for (let i = 0; i < path.length && path[i] !== island; i++) {
    const node = path[i];
    if (!(node instanceof Element)) continue;
    const role = node.getAttribute('role');
    if (role === 'link' && key === 'Enter') return true;
    if (
      role === 'button' ||
      role === 'checkbox' ||
      role === 'radio' ||
      role === 'switch' ||
      role === 'menuitem' ||
      role === 'menuitemcheckbox' ||
      role === 'menuitemradio' ||
      role === 'tab' ||
      role === 'option'
    ) {
      return true;
    }
  }
  return false;
}

function waitForInteract(el: Element, run: (onSettled: () => void) => void): void {
  let started = false;
  let pending: (() => void) | null = null;
  const submitRoots: ShadowRoot[] = [];

  const finish = (): void => {
    el.removeEventListener('click', onClick, true);
    el.removeEventListener('submit', onSubmit, true);
    el.removeEventListener('keydown', onKeydown, true);
    for (let i = 0; i < submitRoots.length; i++) {
      submitRoots[i].removeEventListener('submit', onSubmit, true);
    }
    const replay = pending;
    pending = null;
    // hydrate() schedules mounted hooks as microtasks. Let those complete
    // before delivering the first user action to its newly bound handler.
    if (replay) {
      queueMicrotask(() => {
        try {
          replay();
        } catch (err) {
          console.error('[Purity] mountIslands: interaction replay failed:', err);
        }
      });
    }
  };
  const start = (): void => {
    if (started) return;
    started = true;
    el.removeEventListener('pointerdown', start, true);
    el.removeEventListener('focusin', start, true);
    run(finish);
  };
  const onClick = (event: Event): void => {
    const click = event as MouseEvent;
    // Modified clicks and picker controls need the browser's original
    // user activation. They still begin hydration, but are not replayed.
    if (
      !event.cancelable ||
      (typeof click.button === 'number' && click.button !== 0) ||
      click.altKey ||
      click.ctrlKey ||
      click.metaKey ||
      click.shiftKey
    ) {
      start();
      return;
    }
    const target = interactionTarget(event, el);
    const label = target?.closest('label');
    const picker =
      target instanceof HTMLInputElement
        ? target
        : label instanceof HTMLLabelElement
          ? label.control
          : null;
    if (
      !target ||
      (picker instanceof HTMLInputElement && /^(file|color)$/.test(picker.type)) ||
      target.closest('a[target="_blank"], a[download]')
    ) {
      start();
      return;
    }
    const path = interactionPath(target, el);
    event.preventDefault();
    event.stopImmediatePropagation();
    // Keep only the first activation while a lazy chunk loads. This also
    // avoids submitting a form twice when the user clicks repeatedly.
    const replayInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: click.button,
      buttons: click.buttons,
      clientX: click.clientX,
      clientY: click.clientY,
      screenX: click.screenX,
      screenY: click.screenY,
      detail: click.detail,
      altKey: click.altKey,
      ctrlKey: click.ctrlKey,
      metaKey: click.metaKey,
      shiftKey: click.shiftKey,
    };
    pending ??= () => {
      const live = liveInteractionTarget(target, el, path);
      if (live && !live.closest(':disabled'))
        live.dispatchEvent(new MouseEvent('click', replayInit));
    };
    start();
  };
  const onSubmit = (event: Event): void => {
    if (!event.cancelable || !(event.target instanceof HTMLFormElement)) {
      start();
      return;
    }
    const form = event.target;
    const submitter = (event as SubmitEvent).submitter;
    const formPath = interactionPath(form, el);
    const submitterPath = submitter instanceof Element ? interactionPath(submitter, el) : null;
    event.preventDefault();
    event.stopImmediatePropagation();
    pending ??= () => {
      const liveForm = liveInteractionTarget(form, el, formPath);
      if (!(liveForm instanceof HTMLFormElement)) return;
      const liveSubmitter =
        submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
          ? submitter.isConnected && submitter.form === liveForm
            ? submitter
            : liveInteractionTarget(submitter, el, submitterPath)
          : null;
      liveForm.requestSubmit(
        (liveSubmitter instanceof HTMLButtonElement || liveSubmitter instanceof HTMLInputElement) &&
          liveSubmitter.form === liveForm
          ? liveSubmitter
          : undefined,
      );
    };
    start();
  };
  const onKeydown = (event: Event): void => {
    const key = event as KeyboardEvent;
    const target = interactionTarget(event, el);
    const path = target ? interactionPath(target, el) : null;
    // Native controls turn Enter/Space into click or submit, captured
    // above. Only explicit ARIA controls need their own keydown replay;
    // ordinary focusable content retains its native keyboard behavior.
    if (
      event.cancelable &&
      (key.key === 'Enter' || key.key === ' ') &&
      !key.altKey &&
      !key.ctrlKey &&
      !key.metaKey &&
      target &&
      !(target instanceof HTMLElement && target.isContentEditable) &&
      !target.closest('button, a[href], input, select, textarea, summary') &&
      hasActivationRole(event, el, key.key)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pending ??= () => {
        const live = liveInteractionTarget(target, el, path);
        if (!live) return;
        live.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: key.key,
            code: key.code,
            bubbles: true,
            cancelable: true,
            composed: true,
            altKey: key.altKey,
            ctrlKey: key.ctrlKey,
            metaKey: key.metaKey,
            shiftKey: key.shiftKey,
          }),
        );
      };
    }
    start();
  };
  el.addEventListener('pointerdown', start, { capture: true });
  el.addEventListener('focusin', start, { capture: true });
  el.addEventListener('keydown', onKeydown, { capture: true });
  el.addEventListener('click', onClick, { capture: true });
  el.addEventListener('submit', onSubmit, { capture: true });
  // submit is not composed, so a wrapper cannot see a form inside DSD.
  // Capture it in each open shadow root already rendered in the island.
  const roots: ParentNode[] = [el];
  for (let i = 0; i < roots.length; i++) {
    const descendants = roots[i].querySelectorAll('*');
    for (let j = 0; j < descendants.length; j++) {
      const shadow = descendants[j].shadowRoot;
      if (!shadow) continue;
      shadow.addEventListener('submit', onSubmit, { capture: true });
      submitRoots.push(shadow);
      roots.push(shadow);
    }
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
