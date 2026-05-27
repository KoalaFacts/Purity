// ---------------------------------------------------------------------------
// Component context & lifecycle — minimal, like Solid
//
// Only 3 hooks: onMount, onDestroy, onDispose
// Error handling via onError (bubbles up to parent)
// ---------------------------------------------------------------------------

import { enterHydration, exitHydration, inflateDeferred, isDeferred } from './compiler/compile.ts';
import { watch } from './signals.ts';
import { primeHydrationCache } from './ssr-context.ts';

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
// ComponentContext — lean
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scope — minimal contract used by the dispose-registration path.
//
// signals.ts and styles.ts only ever reach into a context to push a cleanup
// onto `disposers`. each() entries don't need the full ComponentContext
// shape (mount/destroy/error handlers, parent linking, etc.) — just a
// `disposers` slot. By typing the context stack as Scope rather than the
// full class, we let runEntryMapFn push a 1-field plain object per row
// instead of allocating a 10-field class instance for the same purpose.
// ---------------------------------------------------------------------------

export interface Scope {
  disposers: (() => void)[] | null;
}

export class ComponentContext implements Scope {
  mounted: (() => void)[] | null = null;
  destroyed: (() => void)[] | null = null;
  errorHandlers: ((err: unknown) => void)[] | null = null;
  disposers: (() => void)[] | null = null;
  nodes: Node[] | null = null;
  parent: ComponentContext | null = null;
  children: ComponentContext[] | null = null;
  _isMounted = false;
  _isDestroyed = false;
  _slotContent: unknown = undefined;
  // Set by PurityElement.connectedCallback when the component is a Custom
  // Element. null for plain mount() roots (no host element to attach to).
  _internals: ElementInternals | null = null;
  // Ref counts per state name. bindComponentState() composes — many sources
  // can drive the same state and the host only flips when count crosses 0↔1.
  _stateRefs: Map<string, number> | null = null;

  _handleError(err: unknown): void {
    if (this.errorHandlers) {
      for (let i = 0; i < this.errorHandlers.length; i++) {
        try {
          this.errorHandlers[i](err);
        } catch (e) {
          console.error('[Purity] Error in onError handler:', e);
        }
      }
    } else if (this.parent) {
      this.parent._handleError(err);
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Context stack
// ---------------------------------------------------------------------------

const contextStack: Scope[] = [];

export function getCurrentContext(): Scope | null {
  return contextStack[contextStack.length - 1] || null;
}

export function pushContext(ctx: Scope): void {
  contextStack.push(ctx);
}

export function popContext(): Scope | undefined {
  return contextStack.pop();
}

// ---------------------------------------------------------------------------
// Lifecycle hooks — only 3 + error
// ---------------------------------------------------------------------------

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
  const ctx = getCurrentContext();
  if (ctx instanceof ComponentContext) (ctx.mounted ??= []).push(fn);
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
  const ctx = getCurrentContext();
  if (ctx instanceof ComponentContext) (ctx.destroyed ??= []).push(fn);
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
 * Register an error handler. Catches errors from render and lifecycle hooks.
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
  const ctx = getCurrentContext();
  if (ctx instanceof ComponentContext) (ctx.errorHandlers ??= []).push(fn);
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
 * Custom Elements with DSD content hydrate their own shadow tree from
 * `connectedCallback`.
 *
 * Mismatch fallback — if the user's value at a slot is an Array or a Node
 * provided directly (rather than a deferred template / reactive accessor /
 * primitive), that one slot's SSR content is replaced. Function-valued
 * slots (`each`/`when`/`match` and other reactive accessors returning
 * Nodes) likewise replace their slot on first read; the surrounding tree
 * is preserved.
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
  // Prime the resource cache from the JSON payload renderToString embedded.
  // Done before any DOM manipulation so the script tag is still in place.
  primeResourceHydrationCache(container);

  // Empty container — nothing to hydrate. Fall back to a fresh mount so
  // hydrate() works as a drop-in for mount() in dev/test setups that
  // skipped the SSR step.
  if (!container.firstChild) {
    return mount(component, container);
  }

  const ctx = new ComponentContext();
  const parentCtx = getCurrentContext();
  if (parentCtx instanceof ComponentContext) {
    ctx.parent = parentCtx;
    (parentCtx.children ??= []).push(ctx);
  }

  pushContext(ctx);
  enterHydration();

  let view: unknown;
  try {
    view = component();
  } catch (err) {
    exitHydration();
    popContext();
    ctx._handleError(err);
    return { unmount: () => {} };
  }
  exitHydration();
  popContext();

  if (isDeferred(view)) {
    // Move the SSR children into a fragment, inflate the template against
    // them, then re-insert. Working through a fragment lets the hydrate
    // factory walk siblings without worrying about live-DOM observers, and
    // gives us a clean handle (frag.childNodes) for ctx.nodes after.
    const frag = container.ownerDocument.createDocumentFragment();
    while (container.firstChild) frag.appendChild(container.firstChild);
    try {
      inflateDeferred(view, frag);
    } catch (err) {
      // The walker hit a structural mismatch (cursor went off the rails on
      // null sibling / wrong nodeType). The opt-in mismatch warnings would
      // already have logged the divergence; here we recover by dropping the
      // SSR DOM and re-rendering fresh so the page keeps working.
      console.error('[Purity] Hydration walk failed; falling back to fresh mount:', err);
      if (ctx.parent?.children) {
        const idx = ctx.parent.children.indexOf(ctx);
        if (idx !== -1) ctx.parent.children.splice(idx, 1);
      }
      while (container.firstChild) container.removeChild(container.firstChild);
      return mount(component, container);
    }
    ctx.nodes = Array.from(frag.childNodes);
    container.appendChild(frag);
  } else if (view instanceof Node) {
    // Component returned a non-deferred Node (e.g. user wrapped html`` in
    // something that bypassed deferral). Fall back to lossy: clear + insert.
    while (container.firstChild) container.removeChild(container.firstChild);
    if (view instanceof DocumentFragment) {
      container.appendChild(view);
      ctx.nodes = Array.from(container.childNodes);
    } else {
      container.appendChild(view);
      ctx.nodes = [view];
    }
  }

  ctx._isMounted = true;

  if (ctx.mounted) {
    queueMicrotask(() => {
      if (!ctx.mounted) return;
      pushContext(ctx);
      try {
        for (let i = 0; i < ctx.mounted.length; i++) {
          try {
            ctx.mounted[i]();
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
  const boundaryScripts = doc.querySelectorAll(
    `script[id^="${PER_BOUNDARY_RESOURCE_SCRIPT_PREFIX}"]`,
  );
  if (boundaryScripts.length > 0) {
    if (!merged) merged = { ordered: [], keyed: {} };
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
          Object.assign(merged.keyed, parsed.keyed as Record<string, unknown>);
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
  if (Array.isArray(parsed)) return { ordered: parsed, keyed: {} };
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as { ordered?: unknown; keyed?: unknown };
    return {
      ordered: Array.isArray(obj.ordered) ? obj.ordered : [],
      keyed:
        obj.keyed && typeof obj.keyed === 'object' ? (obj.keyed as Record<string, unknown>) : {},
    };
  }
  return { ordered: [], keyed: {} };
}

export function mount(component: ComponentFn, container: Element): MountResult {
  const ctx = new ComponentContext();
  const parentCtx = getCurrentContext();
  if (parentCtx instanceof ComponentContext) {
    ctx.parent = parentCtx;
    (parentCtx.children ??= []).push(ctx);
  }

  pushContext(ctx);

  let fragment: Node | DocumentFragment;
  try {
    fragment = component();
  } catch (err) {
    popContext();
    ctx._handleError(err);
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

  if (ctx.mounted) {
    queueMicrotask(() => {
      if (!ctx.mounted) return;
      // Make the component context active during onMount callbacks so
      // onDispose() / onError() registered inside them attach to this
      // component instead of silently no-oping.
      pushContext(ctx);
      try {
        for (let i = 0; i < ctx.mounted.length; i++) {
          try {
            ctx.mounted[i]();
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
  const ctx = getCurrentContext();
  if (!(ctx instanceof ComponentContext)) return;
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

  (ctx.disposers ??= []).push(() => {
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

  // Run disposers
  if (ctx.disposers) {
    for (let i = 0; i < ctx.disposers.length; i++) {
      try {
        ctx.disposers[i]();
      } catch (err) {
        console.error('[Purity] Error during disposal:', err);
      }
    }
    ctx.disposers = null;
  }

  ctx._isDestroyed = true;
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
