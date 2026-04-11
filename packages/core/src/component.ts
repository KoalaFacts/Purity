// ---------------------------------------------------------------------------
// Component context & lifecycle — minimal, like Solid
//
// Only 3 hooks: onMount, onDestroy, onDispose
// Error handling via onError (bubbles up to parent)
// ---------------------------------------------------------------------------

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

export class ComponentContext {
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
          console.error("[Purity] Error in onError handler:", e);
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

const contextStack: ComponentContext[] = [];

export function getCurrentContext(): ComponentContext | null {
  return contextStack[contextStack.length - 1] || null;
}

export function pushContext(ctx: ComponentContext): void {
  contextStack.push(ctx);
}

export function popContext(): ComponentContext | undefined {
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
  if (ctx) (ctx.mounted ??= []).push(fn);
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
  if (ctx) (ctx.destroyed ??= []).push(fn);
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
  if (ctx) (ctx.errorHandlers ??= []).push(fn);
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
export function mount(component: ComponentFn, container: Element): MountResult {
  const ctx = new ComponentContext();
  const parentCtx = getCurrentContext();
  if (parentCtx) {
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
      for (let i = 0; i < ctx.mounted.length; i++) {
        try {
          ctx.mounted[i]();
        } catch (err) {
          ctx._handleError(err);
        }
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
        console.error("[Purity] Error during disposal:", err);
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
        console.error("[Purity] Error in onDestroy:", err);
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
