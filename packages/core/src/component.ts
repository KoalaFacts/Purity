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

/** Mount a client-rendered root with its own lifecycle. */
export function mount(component: ComponentFn, container: Element): MountResult {
  const ctx = new ComponentContext();
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
    const cur = refs.get(name) ?? 0;
    refs.set(name, cur + (on ? 1 : -1));
    if (cur === 0 && on) {
      try {
        states.add(name);
      } catch (err) {
        /* v8 ignore next */
        console.error('[Purity] bindComponentState add failed:', err);
      }
    } else if (cur === 1 && !on) {
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
  if (rollback) ctx._rollback = true;

  const children = ctx.children;
  if (children) {
    // Detach before descending: an onDestroy hook can dispose a sibling.
    // Keep the iteration stable and avoid O(n²) parent-array removals.
    ctx.children = null;
    for (let i = children.length - 1; i >= 0; i--) {
      unmountContext(children[i], rollback, false, bubbleDestroyError);
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
    // Detached custom elements keep their DOM, not an obsolete owner's references to it.
    ctx.nodes = null;
  }

  ctx._isDestroyed = true;
  disposeScope(ctx);
  ctx._isMounted = false;

  const destroyed = ctx.destroyed;
  if (destroyed) {
    for (let i = 0; i < destroyed.length; i++) {
      try {
        destroyed[i]();
      } catch (err) {
        if (bubbleDestroyError && !rollback) ctx._handleError(err);
        else console.error('[Purity] Error in onDestroy:', err);
      }
    }
    ctx.destroyed = null;
  }

  const siblings = ctx.parent?.children;
  if (siblings) {
    const idx = siblings.indexOf(ctx);
    if (idx !== -1) siblings.splice(idx, 1);
  }

  // Never initialize optional callbacks or slots merely to clear them.
  ctx.mounted &&= null;
  ctx.errorHandlers &&= null;
  // Arbitrary slot values may include falsy host objects; clear every defined value.
  ctx.parent &&= null;
  if (ctx._slotContent !== undefined) ctx._slotContent = undefined;
}
