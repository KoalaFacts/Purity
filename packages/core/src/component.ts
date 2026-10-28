// ---------------------------------------------------------------------------
// Component context & lifecycle — minimal, like Solid
//
// Only 3 hooks: onMount, onDestroy, onDispose
// Error handling via onError (bubbles up to parent)
// ---------------------------------------------------------------------------

import {
  enterHydration,
  exitHydration,
  inflateDeferred,
  isDeferred,
} from './compiler/hydrate-runtime.ts';
import { disposeScope, watch } from './signals.ts';
import {
  ComponentContext,
  attachToOwner,
  getCurrentComponent,
  getCurrentContext,
  pushContext,
  popContext,
} from './scope.ts';
import { primeHydrationCache } from './ssr/hydration-cache.ts';

/**
 * A zero-argument function that returns a DOM subtree.
 * Passed to {@link mount} to render an application root.
 *
 * @example
 * ```ts
 * const App: ComponentFn = () => html`<p-counter></p-counter>`;
 * mount(App, document.getElementById('app')!);
 * ```
 */
export type ComponentFn = () => Node | DocumentFragment;

/**
 * Handle returned by {@link mount} to tear down a mounted component tree.
 *
 * @example
 * ```ts
 * const { unmount } = mount(App, el);
 * // later…
 * unmount(); // removes DOM nodes, runs onDestroy callbacks, disposes watchers
 * ```
 */
export interface MountResult {
  unmount: () => void;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks — only 3 + error
// ---------------------------------------------------------------------------

// Add a component callback registered from the current owner. A lean scope
// (branch, row, re-running effect) removes it again when disposed, so hidden
// branches don't leave callbacks on the long-lived component.
function addCallback<T>(ctx: ComponentContext, list: T[], fn: T): void {
  list.push(fn);
  const owner = getCurrentContext();
  if (owner && owner !== ctx) {
    (owner.disposers ??= []).push(() => {
      // The component's own teardown keeps it: it runs with the component.
      if (ctx._isDestroyed) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    });
  }
}

/**
 * Register a callback that runs after the component is inserted into the DOM.
 * Runs as a microtask — DOM is guaranteed to be ready.
 *
 * @example
 * ```ts
 * component('p-widget', () => {
 *   onMount(() => {
 *     console.log('DOM is ready');
 *     const el = document.querySelector('.my-el');
 *     // safe to query DOM here
 *   });
 *   return html`<div class="my-el">Hello</div>`;
 * });
 * ```
 */
export function onMount(fn: () => void): void {
  const ctx = getCurrentComponent();
  if (!ctx) return;
  if (!ctx._isMounted) {
    addCallback(ctx, (ctx.mounted ??= []), fn);
    return;
  }
  // Registered by a branch first shown after the component mounted: the
  // mount drain already ran, so schedule this one under the current owner.
  const owner = getCurrentContext()!;
  let cancelled = false;
  if (owner !== ctx) (owner.disposers ??= []).push(() => (cancelled = true));
  queueMicrotask(() => {
    if (cancelled || ctx._isDestroyed) return;
    pushContext(owner);
    try {
      fn();
    } catch (err) {
      ctx._handleError(err);
    } finally {
      popContext();
    }
  });
}

/** @internal Schedule mounted hooks under the component that owns their work. */
export function scheduleMountCallbacks(ctx: ComponentContext): void {
  if (!ctx.mounted) return;
  queueMicrotask(() => {
    const mounted = ctx.mounted;
    if (!mounted) return;
    pushContext(ctx);
    try {
      // A hook can unmount its owner; later hooks must not revive its work.
      for (let i = 0; i < mounted.length && !ctx._isDestroyed; i++) {
        try {
          mounted[i]();
        } catch (err) {
          ctx._handleError(err);
        }
      }
    } finally {
      popContext();
    }
    ctx.mounted = null;
  });
}

/**
 * Register a callback that runs when the component is unmounted.
 *
 * @example
 * ```ts
 * component('p-timer', () => {
 *   onDestroy(() => console.log('component removed'));
 *   return html`<p>Hello</p>`;
 * });
 * ```
 */
export function onDestroy(fn: () => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx.destroyed ??= []), fn);
}

/**
 * Register a cleanup function that auto-runs on component unmount.
 * Use this to dispose of watch/effect subscriptions.
 *
 * @example
 * ```ts
 * component('p-live', () => {
 *   const stop = watch(data, (val) => updateChart(val));
 *   onDispose(stop);  // auto-cleanup when component unmounts
 *
 *   onMount(() => {
 *     const id = setInterval(() => poll(), 5000);
 *     onDispose(() => clearInterval(id));  // also works inside onMount
 *   });
 *
 *   return html`<div>Live data</div>`;
 * });
 * ```
 */
export function onDispose(fn: () => void): void {
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(fn);
}

/**
 * Register an error handler. Catches errors from render, lifecycle hooks, and
 * subsequent scheduled runs of component-owned watches/effects. A watch's
 * initial run remains synchronous and throws to its caller.
 * Errors bubble up to parent components if not handled.
 *
 * @example
 * ```ts
 * component('p-safe', () => {
 *   onError((err) => {
 *     console.error('caught:', err);
 *     // could show fallback UI
 *   });
 *   return html`<p-risky-child></p-risky-child>`;
 * });
 * ```
 */
export function onError(fn: (err: unknown) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx.errorHandlers ??= []), fn);
}

// ---------------------------------------------------------------------------
// Form-associated lifecycle hooks — only invoked when the component was
// declared with `component(tag, fn, { formAssociated: true })`. Defined on
// the PurityElement class unconditionally; the browser only dispatches when
// both `static formAssociated = true` and the relevant callback exist on
// the prototype, so non-form components pay nothing.
// ---------------------------------------------------------------------------

/**
 * Register a callback that runs when the host element is associated with
 * (or disassociated from) a `<form>`. Only fires for components declared
 * with `{ formAssociated: true }`.
 *
 * @param fn Receives the new form (or `null` when disassociated).
 */
export function onFormAssociated(fn: (form: HTMLFormElement | null) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formAssociated ??= []), fn);
}

/**
 * Register a callback that runs when the containing form's `disabled` state
 * changes (typically via a `<fieldset disabled>` ancestor). Only fires for
 * components declared with `{ formAssociated: true }`.
 */
export function onFormDisabled(fn: (disabled: boolean) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formDisabled ??= []), fn);
}

/**
 * Register a callback that runs when the containing form is reset.
 * Components should clear their local state. Only fires for components
 * declared with `{ formAssociated: true }`.
 */
export function onFormReset(fn: () => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formReset ??= []), fn);
}

/**
 * Register a callback that runs during form state restoration — both
 * back/forward cache restore and browser autofill. `state` is whatever the
 * component last passed to `internals().setFormValue(value, state)`; `mode`
 * is `'restore'` (bfcache) or `'autocomplete'` (autofill).
 *
 * Only fires for components declared with `{ formAssociated: true }`.
 */
export function onFormStateRestore(
  fn: (state: string | File | FormData | null, mode: 'restore' | 'autocomplete') => void,
): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formStateRestore ??= []), fn);
}

// ---------------------------------------------------------------------------
// mount(component, container)
// ---------------------------------------------------------------------------

/**
 * Mount a component into a DOM container.
 *
 * @example
 * ```ts
 * const { unmount } = mount(
 *   () => html`<p-app></p-app>`,
 *   document.getElementById('app')!
 * );
 *
 * // Later — tear down the component:
 * unmount();
 * ```
 *
 * @returns Object with `unmount()` to remove the component.
 */
/** @internal — hydrate connected DSD elements after their parent bound props. */
export function hydratePendingCustomElements(root: ParentNode): void {
  const elements = root.querySelectorAll('*');
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const hydrateElement = (element as Element & { _hydrateSSR?: () => void })._hydrateSSR;
    if (typeof hydrateElement === 'function') hydrateElement.call(element);
  }
}

/**
 * Hydrate a server-rendered root: walk the existing SSR DOM, attach reactive
 * bindings to the existing nodes (no re-rendering), and return an unmount
 * handle.
 *
 * **Marker-walking hydration.** `html\`\`` returns a deferred-template thunk
 * during hydration; the hydrator inflates each thunk against the slice of
 * SSR DOM it owns, walking `<!--[--><!--]-->` marker pairs to locate
 * expression slots without rebuilding nodes. Nested templates (`html\`<p>${
 * html\`<span>${name}</span>\`}</p>\``) inflate against their slot's subtree.
 * Custom Elements with DSD content hydrate their own shadow tree after the
 * parent has assigned their typed property bindings.
 *
 * Mismatch fallback — if the user's value at a slot is an Array or a Node
 * provided directly (rather than a deferred template / reactive accessor /
 * primitive), that one slot's SSR content is replaced. Function-valued
 * slots (`each`/`when`/`match` and other reactive accessors returning
 * Nodes) likewise replace their slot on first read; the surrounding tree
 * is preserved. A root component may also return an existing direct child
 * Node (for example, an already-connected Custom Element), which is reused.
 * A freshly created non-deferred root (including client-only AOT) is rejected:
 * replacing server nodes would discard focus, edits, and element identity.
 * Build the SSR client with `purity({ hydratable: true })`.
 *
 * @param container Element pre-rendered by `@purityjs/ssr`'s `renderToString`.
 * @param component The same component function used during SSR.
 * @returns Object with `unmount()` — same shape as `mount()`.
 *
 * @example
 * ```ts
 * import { hydrate } from '@purityjs/core';
 * import { App } from './app.ts';
 *
 * hydrate(document.getElementById('app')!, App);
 * ```
 */
export function hydrate(container: Element, component: ComponentFn): MountResult {
  // Empty container — nothing to hydrate. Fall back to a fresh mount so
  // hydrate() works as a drop-in for mount() in dev/test setups that
  // skipped the SSR step. Checked before priming the resource cache: with
  // no SSR DOM there's nothing to adopt, and priming here would leak the
  // shell's cached values into a fresh render (and clobber another root's
  // module-level cache) as a side effect.
  if (!container.firstChild) {
    return mount(component, container);
  }

  // Prime the resource cache from the JSON payload renderToString embedded.
  // Done before any DOM manipulation so the script tag is still in place.
  primeResourceHydrationCache(container);

  const ctx = new ComponentContext();
  attachToOwner(ctx, unmountContext);

  pushContext(ctx);
  enterHydration();

  let view: unknown;
  try {
    view = component();
  } catch (err) {
    exitHydration();
    popContext();
    // Report while error handlers and the parent are still available, then
    // release everything the abandoned render created, even on rethrow.
    // An error handler can unmount the parent while this child is attached.
    // Suppress the failed render's destroy lifecycle before dispatching it.
    ctx.destroyed = null;
    try {
      ctx._handleError(err);
    } finally {
      unmountContext(ctx);
    }
    return { unmount: () => {} };
  }
  exitHydration();
  popContext();

  if (isDeferred(view)) {
    // Inflate in place. Moving SSR nodes through a fragment disconnects and
    // reconnects nested custom elements, tearing down their hydrated shadow
    // trees and rendering them a second time.
    try {
      inflateDeferred(view, container);
    } catch (err) {
      // The walker hit a structural mismatch (cursor went off the rails on
      // null sibling / wrong nodeType). The opt-in mismatch warnings would
      // already have logged the divergence; here we recover by dropping the
      // SSR DOM and re-rendering fresh so the page keeps working.
      console.error('[Purity] Hydration walk failed; falling back to fresh mount:', err);
      // Tear down the abandoned context before re-rendering. The failed
      // render may have registered disposers (live watch/resource
      // subscriptions), onDestroy/onError handlers, and child contexts; left
      // orphaned they keep running and leak. unmountContext drains them and
      // removes ctx from parent.children itself. ctx.nodes is still null
      // (set only on the success path below), so no DOM is touched here.
      unmountContext(ctx);
      while (container.firstChild) container.removeChild(container.firstChild);
      return mount(component, container);
    }
    ctx.nodes = Array.from(container.childNodes);
  } else if (view instanceof Node && view.parentNode === container) {
    // A component may return a custom element already present as a direct
    // child of the SSR root. Reuse exactly that live node: no generated
    // client-only AOT factory returns an already-connected child here.
    // Preserve its shadow tree and mounted callback ownership.
    ctx.nodes = Array.from(container.childNodes);
  } else if (
    view !== null &&
    typeof view === 'object' &&
    (view as { __purity_deferred_match__?: unknown }).__purity_deferred_match__ === true
  ) {
    // A root-level when()/match() returns its deferred control-flow handle,
    // not a DOM factory result. Keeping its existing SSR content is the
    // established root contract (the nested-slot inflater owns adoption).
    // In particular, asyncRoute() returns when() at the application root.
    // Do not treat this marker as detached client-only AOT DOM.
    ctx.nodes = Array.from(container.childNodes);
  } else {
    // A client-only AOT factory creates detached DOM during hydrate().
    // Reject detached nodes/fragments rather than replacing the SSR tree.
    ctx.destroyed = null;
    unmountContext(ctx);
    throw new Error('[Purity] hydrate() requires purity({ hydratable: true })');
  }

  hydratePendingCustomElements(container);
  ctx._isMounted = true;

  scheduleMountCallbacks(ctx);

  return { unmount: () => unmountContext(ctx) };
}

const RESOURCE_SCRIPT_ID = '__purity_resources__';
// Per-boundary cache prime — emitted by `renderToStream` next to each
// streamed `<template id="purity-s-N">` chunk. ADR 0006 Phase 6 second-half.
const PER_BOUNDARY_RESOURCE_SCRIPT_PREFIX = '__purity_resources_';

function primeResourceHydrationCache(container: Element): void {
  // The script tag may be inside the container, immediately after it (when
  // renderToString output is appended whole), or at document scope. Try the
  // most likely locations in order. Document-scope is the canonical case
  // because the SSR flow is `document.getElementById('app').outerHTML = ssrOutput`.
  const doc = container.ownerDocument ?? globalThis.document;
  /* v8 ignore next 2 -- tests run in jsdom which always has ownerDocument */
  if (!doc) return;

  // Start with the shell-level cache. Accepts either the legacy positional
  // array or the `{ ordered, keyed }` object shape; merge per-boundary
  // keyed entries on top so streamed boundaries' resources hit the cache.
  const shellEl =
    container.querySelector(`script#${RESOURCE_SCRIPT_ID}`) ??
    doc.getElementById(RESOURCE_SCRIPT_ID);
  let merged: { ordered: unknown[]; keyed: Record<string, unknown> } | null = null;
  if (shellEl?.textContent != null) {
    try {
      const parsed = JSON.parse(shellEl.textContent) as unknown;
      merged = normalizeCachePayload(parsed);
    } catch (err) {
      console.error('[Purity] Failed to parse hydration cache:', err);
    }
    if (shellEl.parentNode) shellEl.parentNode.removeChild(shellEl);
  }

  // Find every streamed boundary's cache and merge keyed entries. The
  // positional `ordered` from boundaries is dropped — boundary indices
  // collide with the shell's index space, so we only support keyed
  // resources for streaming. Scan in document order so a later boundary's
  // entry wins on key collision (matches "later wins" everywhere else).
  //
  // Prefer container scope: after `__purity_swap` runs, each boundary's
  // `__purity_resources_N__` script lands inside the root it belongs to
  // (insertBefore at the in-root boundary marker). Scoping to the container
  // means a second `hydrate()` root keeps its own scripts instead of having
  // the first root consume + delete every per-boundary script globally. Fall
  // back to document scope only when the container holds none — the
  // append-whole / non-streamed layouts that emit the scripts as siblings.
  const boundarySelector = `script[id^="${PER_BOUNDARY_RESOURCE_SCRIPT_PREFIX}"]`;
  let boundaryScripts = container.querySelectorAll(boundarySelector);
  if (boundaryScripts.length === 0) {
    boundaryScripts = doc.querySelectorAll(boundarySelector);
  }
  if (boundaryScripts.length > 0) {
    if (!merged) merged = { ordered: [], keyed: Object.create(null) };
    for (let i = 0; i < boundaryScripts.length; i++) {
      const el = boundaryScripts[i] as Element;
      if (el.textContent == null) continue;
      try {
        const parsed = JSON.parse(el.textContent) as { keyed?: unknown };
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.keyed &&
          typeof parsed.keyed === 'object'
        ) {
          // The null-prototype destination stores reserved JSON keys as data,
          // with no inherited setters for "__proto__" or other names.
          Object.assign(merged.keyed, parsed.keyed);
        }
      } catch (err) {
        console.error('[Purity] Failed to parse per-boundary hydration cache:', err);
      }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }

  if (merged) primeHydrationCache(merged);
}

function normalizeCachePayload(parsed: unknown): {
  ordered: unknown[];
  keyed: Record<string, unknown>;
} {
  // Allocate one safe destination for legacy, current and invalid payloads.
  // Own JSON keys (including "__proto__") never hit inherited setters.
  const keyed: Record<string, unknown> = Object.create(null);
  let ordered: unknown[] = [];
  if (Array.isArray(parsed)) {
    ordered = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as { ordered?: unknown; keyed?: unknown };
    if (obj.keyed && typeof obj.keyed === 'object') Object.assign(keyed, obj.keyed);
    if (Array.isArray(obj.ordered)) ordered = obj.ordered;
  }
  return { ordered, keyed };
}

export function mount(component: ComponentFn, container: Element): MountResult {
  const ctx = new ComponentContext();
  attachToOwner(ctx, unmountContext);

  pushContext(ctx);

  let fragment: Node | DocumentFragment;
  try {
    fragment = component();
  } catch (err) {
    popContext();
    // A failed render has no usable unmount handle. Keep error propagation
    // intact, but always tear down its subscriptions and completed children.
    // An error handler can unmount the parent while this child is attached.
    // Suppress the failed render's destroy lifecycle before dispatching it.
    ctx.destroyed = null;
    try {
      ctx._handleError(err);
    } finally {
      unmountContext(ctx);
    }
    return { unmount: () => {} };
  }

  popContext();

  if (fragment instanceof DocumentFragment) {
    ctx.nodes = Array.from(fragment.childNodes);
  } else if (fragment instanceof Node) {
    ctx.nodes = [fragment];
  }

  if (container && fragment) {
    container.appendChild(fragment);
  }

  ctx._isMounted = true;

  scheduleMountCallbacks(ctx);

  return { unmount: () => unmountContext(ctx) };
}

// ---------------------------------------------------------------------------
// unmountContext
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// bindComponentState — reactively drive an ElementInternals custom state
//
// Sync membership of `name` in the host element's CustomStateSet to the
// truthiness of `accessor()`. Composes across sources: multiple binders to
// the same state name are ref-counted, and the host flips only on the
// 0↔1 boundary. Auto-disposed when the surrounding component unmounts.
// ---------------------------------------------------------------------------

/**
 * Reactively drive a CSS custom state on the surrounding component's host
 * element. The state is added/removed in lockstep with the truthiness of
 * `accessor()`. Users style with `:state(name)` or `:host(:state(name))`.
 *
 * No-op when called outside a `component()` render, or when running on a
 * platform without `ElementInternals.states` support.
 *
 * @example
 * ```ts
 * component('p-data', () => {
 *   const r = resource(fetchUser);   // already auto-binds 'loading' / 'error'
 *   bindComponentState('empty', () => !r() && !r.loading());
 *   return html`<div>${r}</div>`;
 * });
 * ```
 */
export function bindComponentState(name: string, accessor: () => unknown): void {
  const ctx = getCurrentComponent();
  if (!ctx) return;
  const internals = ctx._internals;
  const states = internals?.states as
    | { add: (s: string) => void; delete: (s: string) => void }
    | undefined;
  if (!states) return;

  const refs = (ctx._stateRefs ??= new Map());
  let prevOn = false;

  const dispose = watch(() => {
    const on = !!accessor();
    if (on === prevOn) return;
    prevOn = on;
    const cur = refs.get(name) ?? 0;
    const next = cur + (on ? 1 : -1);
    refs.set(name, next);
    if (cur === 0 && next === 1) {
      try {
        states.add(name);
      } catch (err) {
        /* v8 ignore next -- defensive; spec-compliant impls don't throw on valid idents */
        console.error('[Purity] bindComponentState add failed:', err);
      }
    } else if (cur === 1 && next === 0) {
      try {
        states.delete(name);
      } catch {
        /* v8 ignore next -- defensive; symmetrical to add() */
      }
    }
  });

  // Release with the current disposal owner (a hidden branch, a removed row),
  // not the host: the host outlives them.
  const owner = getCurrentContext()!;
  (owner.disposers ??= []).push(() => {
    dispose();
    // Release this binder's ref if it was contributing at dispose time.
    if (prevOn) {
      const cur = refs.get(name) ?? 0;
      const next = cur - 1;
      refs.set(name, next);
      if (cur === 1 && next === 0) {
        try {
          states.delete(name);
        } catch {
          /* v8 ignore next -- defensive */
        }
      }
    }
  });
}

function unmountContext(ctx: ComponentContext): void {
  if (ctx._isDestroyed) return;

  // Unmount children first
  if (ctx.children) {
    for (let i = ctx.children.length - 1; i >= 0; i--) {
      unmountContext(ctx.children[i]);
    }
    ctx.children = null;
  }

  // Remove DOM
  if (ctx.nodes) {
    for (let i = 0; i < ctx.nodes.length; i++) {
      const node = ctx.nodes[i];
      /* v8 ignore next -- defensive; nodes are attached when set */
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    ctx.nodes = null;
  }

  // Mark destroyed before disposers run: lean scopes released by this teardown
  // must not unregister their callbacks from a component that is going away.
  ctx._isDestroyed = true;
  disposeScope(ctx);
  ctx._isMounted = false;

  // Run destroy callbacks
  if (ctx.destroyed) {
    for (let i = 0; i < ctx.destroyed.length; i++) {
      try {
        ctx.destroyed[i]();
      } catch (err) {
        console.error('[Purity] Error in onDestroy:', err);
      }
    }
    ctx.destroyed = null;
  }

  // Remove from parent
  if (ctx.parent?.children) {
    const idx = ctx.parent.children.indexOf(ctx);
    if (idx !== -1) ctx.parent.children.splice(idx, 1);
  }

  // Release remaining references for GC
  ctx.mounted = null;
  ctx.errorHandlers = null;
  ctx.parent = null;
  ctx._slotContent = undefined;
}
