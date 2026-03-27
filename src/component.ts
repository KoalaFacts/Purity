// ---------------------------------------------------------------------------
// Component context & lifecycle hooks
// ---------------------------------------------------------------------------

export type LifecycleCallback = () => void;
export type ErrorCallback = (err: unknown) => void;
export type ComponentFn = () => Node | DocumentFragment;

export interface MountResult {
  unmount: () => void;
  context: ComponentContext;
}

// ---------------------------------------------------------------------------
// ComponentContext
// ---------------------------------------------------------------------------

export class ComponentContext {
  beforeMount: LifecycleCallback[] = [];
  mounted: LifecycleCallback[] = [];
  beforeUpdate: LifecycleCallback[] = [];
  updated: LifecycleCallback[] = [];
  beforeDestroy: LifecycleCallback[] = [];
  destroyed: LifecycleCallback[] = [];
  errorHandlers: ErrorCallback[] = [];
  disposers: (() => void)[] = [];
  nodes: Node[] | null = null;
  parent: ComponentContext | null = null;
  children: ComponentContext[] = [];
  _isMounted = false;
  _isDestroyed = false;

  _run(callbacks: ((...args: any[]) => void)[], ...args: unknown[]): void {
    for (const fn of callbacks) {
      try {
        fn(...args);
      } catch (err) {
        this._handleError(err);
      }
    }
  }

  _handleError(err: unknown): void {
    if (this.errorHandlers.length > 0) {
      for (const handler of this.errorHandlers) {
        try {
          handler(err);
        } catch (e) {
          console.error('Error in onError handler:', e);
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

function pushContext(ctx: ComponentContext): void {
  contextStack.push(ctx);
}

function popContext(): ComponentContext | undefined {
  return contextStack.pop();
}

// ---------------------------------------------------------------------------
// Lifecycle hook registration
// ---------------------------------------------------------------------------

export function onBeforeMount(fn: LifecycleCallback): void {
  const ctx = getCurrentContext();
  if (ctx) ctx.beforeMount.push(fn);
}

export function onMount(fn: LifecycleCallback): void {
  const ctx = getCurrentContext();
  if (ctx) ctx.mounted.push(fn);
}

export function onBeforeUpdate(fn: LifecycleCallback): void {
  const ctx = getCurrentContext();
  if (ctx) ctx.beforeUpdate.push(fn);
}

export function onUpdate(fn: LifecycleCallback): void {
  const ctx = getCurrentContext();
  if (ctx) ctx.updated.push(fn);
}

export function onBeforeDestroy(fn: LifecycleCallback): void {
  const ctx = getCurrentContext();
  if (ctx) ctx.beforeDestroy.push(fn);
}

export function onDestroy(fn: LifecycleCallback): void {
  const ctx = getCurrentContext();
  if (ctx) ctx.destroyed.push(fn);
}

export function onError(fn: ErrorCallback): void {
  const ctx = getCurrentContext();
  if (ctx) ctx.errorHandlers.push(fn);
}

// ---------------------------------------------------------------------------
// mount(component, container)
// ---------------------------------------------------------------------------

export function mount(component: ComponentFn, container: Element): MountResult {
  const ctx = new ComponentContext();
  const parentCtx = getCurrentContext();
  if (parentCtx) {
    ctx.parent = parentCtx;
    parentCtx.children.push(ctx);
  }

  pushContext(ctx);

  let fragment: Node | DocumentFragment;
  try {
    fragment = component();
  } catch (err) {
    popContext();
    ctx._handleError(err);
    return { unmount: () => {}, context: ctx };
  }

  popContext();

  if (fragment instanceof DocumentFragment) {
    ctx.nodes = Array.from(fragment.childNodes);
  } else if (fragment instanceof Node) {
    ctx.nodes = [fragment];
  } else {
    ctx.nodes = [];
  }

  ctx._run(ctx.beforeMount);

  if (container && fragment) {
    container.appendChild(fragment);
  }

  ctx._isMounted = true;

  queueMicrotask(() => {
    ctx._run(ctx.mounted);
  });

  return {
    unmount: () => unmountContext(ctx),
    context: ctx,
  };
}

// ---------------------------------------------------------------------------
// unmountContext
// ---------------------------------------------------------------------------

function unmountContext(ctx: ComponentContext): void {
  if (ctx._isDestroyed) return;

  ctx._run(ctx.beforeDestroy);

  for (const child of ctx.children) {
    unmountContext(child);
  }

  if (ctx.nodes) {
    for (const node of ctx.nodes) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  }

  for (const dispose of ctx.disposers) {
    try {
      dispose();
    } catch (err) {
      ctx._handleError(err);
    }
  }

  ctx._isDestroyed = true;
  ctx._isMounted = false;

  ctx._run(ctx.destroyed);

  if (ctx.parent) {
    const idx = ctx.parent.children.indexOf(ctx);
    if (idx !== -1) ctx.parent.children.splice(idx, 1);
  }
}

// ---------------------------------------------------------------------------
// notifyBeforeUpdate / notifyUpdate
// ---------------------------------------------------------------------------

export function notifyBeforeUpdate(ctx: ComponentContext | null): void {
  if (ctx && ctx._isMounted && !ctx._isDestroyed) {
    ctx._run(ctx.beforeUpdate);
  }
}

export function notifyUpdate(ctx: ComponentContext | null): void {
  if (ctx && ctx._isMounted && !ctx._isDestroyed) {
    ctx._run(ctx.updated);
  }
}
