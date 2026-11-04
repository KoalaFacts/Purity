// ---------------------------------------------------------------------------
// Component context & lifecycle — minimal, like Solid
//
// Only 3 hooks: onMount, onDestroy, onDispose + onError
// Form-associated hooks (onForm*) live in `@purityjs/core/forms`.
// ---------------------------------------------------------------------------

import {
  attachToOwner,
  ComponentContext,
  disposeScope,
  getCurrentComponent,
  getCurrentContext,
  popContext,
  pushContext,
  watch,
} from '@purityjs/signals';

/**
 * A zero-argument function that returns a DOM subtree.
 * Passed to {@link mount} to render an application root.
 */
export type ComponentFn = () => Node | DocumentFragment;

/**
 * Handle returned by {@link mount} to tear down a mounted component tree.
 */
export interface MountResult {
  unmount: () => void;
}

/** @internal Shared callback registration helper (also used by `./forms`). */
export function addComponentCallback<T>(ctx: ComponentContext, list: T[], fn: T): void {
  list.push(fn);
  const owner = getCurrentContext();
  if (owner && owner !== ctx) {
    (owner.disposers ??= []).push(() => {
      if (ctx._isDestroyed) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    });
  }
}

/**
 * Register a callback that runs after the component is inserted into the DOM.
 * Runs as a microtask — DOM is guaranteed to be ready.
 */
export function onMount(fn: () => void): void {
  const ctx = getCurrentComponent();
  if (!ctx) return;
  if (!ctx._isMounted) {
    addComponentCallback(ctx, (ctx.mounted ??= []), fn);
    return;
  }
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
 */
export function onDestroy(fn: () => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx.destroyed ??= []), fn);
}

/**
 * Register a cleanup function that auto-runs on component or scope unmount.
 */
export function onDispose(fn: () => void): void {
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(fn);
}

/**
 * Register an error handler. Catches errors from render, lifecycle hooks, and
 * subsequent scheduled runs of component-owned watches/effects.
 */
export function onError(fn: (err: unknown) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx.errorHandlers ??= []), fn);
}

/** @internal Shared rollback guard for partially inserted DOM roots. */
export function removeInsertedRoots(nodes: Node[] | null | undefined, container: Node): void {
  if (!nodes) return;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Node;
    if (node.parentNode === container) container.removeChild(node);
  }
}

/** Mount a client-rendered root with its own lifecycle. */
export function mount(component: ComponentFn, container: Element): MountResult {
  const ctx = new ComponentContext();
  ctx._rootContainer = container;
  attachToOwner(ctx, unmountContext);

  pushContext(ctx);

  let fragment: Node | DocumentFragment;
  try {
    fragment = component();
  } catch (err) {
    popContext();
    ctx.destroyed = null;
    try {
      ctx._handleError(err);
    } finally {
      unmountContext(ctx);
    }
    return { unmount: () => {} };
  }

  popContext();

  // A nested root may be destroyed by its parent while its render is running.
  // Do not append content after the owner has already been torn down.
  if (ctx._isDestroyed) return { unmount: () => {} };

  if (fragment instanceof DocumentFragment) {
    ctx.nodes = Array.from(fragment.childNodes);
  } else if (fragment instanceof Node) {
    ctx.nodes = [fragment];
  }

  // Retain the inserted roots locally: teardown during appendChild clears ctx.nodes.
  const insertedNodes = ctx.nodes;
  if (container && fragment) {
    try {
      container.appendChild(fragment);
    } catch (err) {
      // Release reactive work and any DOM inserted before a failing append.
      // A root that failed to mount never executes destruction callbacks.
      ctx.destroyed = null;
      // Keep roots that still belong to another parent or the source fragment.
      unmountContext(ctx, true, true);
      removeInsertedRoots(insertedNodes, container);
      throw err;
    }
    if (ctx._isDestroyed) {
      // connectedCallback can synchronously destroy the owner before append ends.
      // Remove only our roots still in this container, not reparented nodes.
      removeInsertedRoots(insertedNodes, container);
      return { unmount: () => {} };
    }
  }

  ctx._isMounted = true;

  scheduleMountCallbacks(ctx);

  return { unmount: () => unmountContext(ctx) };
}

/**
 * Reactively drive a CSS custom state on the surrounding component's host
 * element (`:state(name)`). Composes across multiple sources via ref-counting.
 */
export function bindComponentState(name: string, accessor: () => unknown): void {
  const ctx = getCurrentComponent();
  if (!ctx) return;
  const internals = ctx._internals as
    | { states?: { add(s: string): void; delete(s: string): void } }
    | null
    | undefined;
  const states = internals?.states;
  if (!states) return;

  const refs = (ctx._stateRefs ??= new Map());
  let prevOn = false;

  // Share the same ref-count transition for signal updates and owner disposal.
  const update = (release = false): undefined => {
    const on = !release && !!accessor();
    if (on === prevOn) return;
    prevOn = on;
    // Drop inactive entries while sharing the updated count with host transitions.
    const count = (refs.get(name) ?? 0) + (on ? 1 : -1);
    if (count) refs.set(name, count);
    else refs.delete(name);
    if (on && count === 1) {
      try {
        states.add(name);
      } catch (err) {
        /* v8 ignore next */
        console.error('[Purity] bindComponentState add failed:', err);
      }
    } else if (!on && count === 0) {
      try {
        states.delete(name);
      } catch {
        /* v8 ignore next */
      }
    }
  };

  const dispose = watch(update);
  const owner = getCurrentContext()!;
  (owner.disposers ??= []).push(() => {
    dispose();
    update(true);
  });
}

/** @internal Shared owner teardown; root hydration imports lifecycle, not the reverse. */
export function unmountContext(
  ctx: ComponentContext,
  rollback = ctx.parent?._rollback,
  keepHostDOM = false,
  bubbleDestroyError = false,
): void {
  if (ctx._isDestroyed) return;
  // Destroy is reentrant: mark the owner before descending, and detach its
  // child list so sibling teardown cannot mutate the active iteration.
  ctx._isDestroyed = true;
  if (rollback) ctx._rollback = true;

  const children = ctx.children;
  if (children) {
    ctx.children = null;
    for (let i = children.length - 1; i >= 0; i--) {
      // A failed insertion leaves some descendant roots outside the target.
      // Only the explicit insertion rollback should remove target-owned DOM.
      const child = children[i];
      // Independently mounted children own committed DOM in their own container;
      // only uncommitted factory roots require preservation.
      unmountContext(
        child,
        rollback,
        keepHostDOM && !!rollback && child._rootContainer == null,
        bubbleDestroyError,
      );
    }
  }

  const nodes = ctx.nodes;
  if (nodes) {
    if (!keepHostDOM) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] as Node;
        /* v8 ignore next */
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    }
    // A disconnected custom element keeps its DOM, not stale owner references.
    ctx.nodes = null;
  }

  disposeScope(ctx);
  ctx._isMounted = false;

  if (ctx.destroyed) {
    for (let i = 0; i < ctx.destroyed.length; i++) {
      try {
        ctx.destroyed[i]();
      } catch (err) {
        if (bubbleDestroyError && !rollback) ctx._handleError(err);
        else console.error('[Purity] Error in onDestroy:', err);
      }
    }
    ctx.destroyed = null;
  }

  if (ctx.parent?.children) {
    const idx = ctx.parent.children.indexOf(ctx);
    if (idx !== -1) ctx.parent.children.splice(idx, 1);
  }

  ctx.mounted = null;
  ctx.errorHandlers = null;
  ctx.parent = null;
  ctx._rootContainer = null;
  ctx._slotContent = undefined;
}
