// ---------------------------------------------------------------------------
// Component context & lifecycle — minimal, like Solid
//
// Only 3 hooks: onMount, onDestroy, onDispose
// Error handling via onError (bubbles up to parent)
// ---------------------------------------------------------------------------

import { popHydrationCtx, pushHydrationCtx } from './compiler/compile.ts';
import { stripHydrationMarkers } from './compiler/ssr-runtime.ts';
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
 * Hydrate a server-rendered root: walk the existing SSR DOM, install reactive
 * bindings in place, return a tear-down handle.
 *
 * **Hydration model:**
 *
 * 1. Read the `<script id="__purity_resources__">` payload (if present) and
 *    prime the resource cache so resources don't refetch on first read.
 * 2. Strip `<!--[-->X<!--]-->` hydration markers from the SSR DOM. After
 *    stripping, the structure matches what a freshly rendered template would
 *    produce, so the same positional paths land on the same nodes.
 * 3. Push a single-shot hydration context that captures `container` as the
 *    root for the next `html\`\`` call.
 * 4. Run the component. The first `html\`\`` call dispatches to the hydrate
 *    factory and binds reactivity to the existing DOM. The factory returns
 *    `null` for shapes the Phase 1 hydrator doesn't cover (custom-element
 *    subtrees, complex nested shapes); in that case `html\`\`` falls back to
 *    the render path. To keep that fallback safe, this function tracks
 *    whether the component returned the existing root or a fresh tree and
 *    swaps in place when needed.
 * 5. Return an `unmount()` handle that disposes the component context.
 *
 * Custom Elements with Declarative Shadow DOM continue to use the lossy
 * shadow-clear path inside `connectedCallback` — Phase 1 hydration covers
 * the light-DOM template surrounding them, not the shadow content itself.
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
  // Reading the cache before stripping ensures the script tag (which is part
  // of the SSR output but NOT a hydration marker) is still present when we
  // look for it. The script is removed after parsing.
  primeResourceHydrationCache(container);

  // Snapshot the existing first child before stripping. The hydrate factory
  // expects `_root.firstChild` to be the rendered top-level element, so
  // `container` itself is the right root to pass — its first child after
  // stripping is the component's outer template root.
  stripHydrationMarkers(container);
  const existingRoot = container.firstChild as Element | null;

  if (existingRoot === null) {
    // No SSR content to hydrate — fall through to a fresh render.
    return mount(component, container);
  }

  const ctx = new ComponentContext();
  pushContext(ctx);
  pushHydrationCtx({ root: existingRoot });
  let result: Node | DocumentFragment;
  try {
    result = component();
  } catch (err) {
    popHydrationCtx();
    popContext();
    ctx._handleError(err);
    return { unmount: () => {} };
  }
  popHydrationCtx();
  popContext();

  // Two outcomes:
  //   (a) Phase 1 hydrator handled the top-level template — `result` is the
  //       existing DOM root; reactivity is bound in place; container's
  //       children are unchanged. No DOM swap needed.
  //   (b) Hydrator returned null (shape unsupported) — `result` is a fresh
  //       DOM tree from the render path; replace container's children.
  if (result !== existingRoot) {
    while (container.firstChild) container.removeChild(container.firstChild);
    if (result instanceof DocumentFragment) {
      ctx.nodes = Array.from(result.childNodes);
    } else if (result instanceof Node) {
      ctx.nodes = [result];
    }
    if (result) container.appendChild(result);
  } else if (result instanceof Node) {
    ctx.nodes = [result];
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
    });
  }

  return {
    unmount: () => {
      if (ctx.disposers) {
        for (let i = 0; i < ctx.disposers.length; i++) {
          try {
            ctx.disposers[i]();
          } catch (e) {
            console.error('[Purity] Error during hydrate unmount:', e);
          }
        }
        ctx.disposers = null;
      }
      if (ctx.nodes) {
        for (let i = 0; i < ctx.nodes.length; i++) {
          const n = ctx.nodes[i];
          if (n.parentNode) n.parentNode.removeChild(n);
        }
        ctx.nodes = null;
      }
      ctx._isDestroyed = true;
      ctx._isMounted = false;
      runHydrateDestroyCallbacks(ctx);
    },
  };
}

function runHydrateDestroyCallbacks(ctx: ComponentContext): void {
  if (!ctx.destroyed) return;
  for (let i = 0; i < ctx.destroyed.length; i++) {
    try {
      ctx.destroyed[i]();
    } catch (err) {
      ctx._handleError(err);
    }
  }
}

const RESOURCE_SCRIPT_ID = '__purity_resources__';

function primeResourceHydrationCache(container: Element): void {
  // The script tag may be inside the container, immediately after it (when
  // renderToString output is appended whole), or at document scope. Try the
  // most likely locations in order. Document-scope is the canonical case
  // because the SSR flow is `document.getElementById('app').outerHTML = ssrOutput`.
  const doc = container.ownerDocument ?? globalThis.document;
  /* v8 ignore next 2 -- tests run in jsdom which always has ownerDocument */
  if (!doc) return;
  const el =
    container.querySelector(`script#${RESOURCE_SCRIPT_ID}`) ??
    doc.getElementById(RESOURCE_SCRIPT_ID);
  if (!el || el.textContent == null) return;
  try {
    const data = JSON.parse(el.textContent) as unknown;
    if (Array.isArray(data)) primeHydrationCache(data);
  } catch (err) {
    console.error('[Purity] Failed to parse hydration cache:', err);
  }
  // Remove the script so a subsequent re-mount doesn't re-prime.
  if (el.parentNode) el.parentNode.removeChild(el);
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
