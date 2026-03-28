// ---------------------------------------------------------------------------
// Component context & lifecycle — minimal, like Solid
//
// Only 3 hooks: onMount, onDestroy, onDispose
// Error handling via onError (bubbles up to parent)
// ---------------------------------------------------------------------------

export type ComponentFn = () => Node | DocumentFragment;

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

export function onMount(fn: () => void): void {
  const ctx = getCurrentContext();
  if (ctx) (ctx.mounted ??= []).push(fn);
}

export function onDestroy(fn: () => void): void {
  const ctx = getCurrentContext();
  if (ctx) (ctx.destroyed ??= []).push(fn);
}

export function onDispose(fn: () => void): void {
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(fn);
}

export function onError(fn: (err: unknown) => void): void {
  const ctx = getCurrentContext();
  if (ctx) (ctx.errorHandlers ??= []).push(fn);
}

// ---------------------------------------------------------------------------
// mount(component, container)
// ---------------------------------------------------------------------------

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
      for (let i = 0; i < ctx.mounted!.length; i++) {
        try {
          ctx.mounted![i]();
        } catch (err) {
          ctx._handleError(err);
        }
      }
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
}
