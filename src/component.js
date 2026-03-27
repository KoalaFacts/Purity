// ---------------------------------------------------------------------------
// Component context & lifecycle hooks
//
// Lifecycle:
//   onBeforeMount ─→ [DOM insertion] ─→ onMount
//   onBeforeUpdate ─→ [DOM patch] ─→ onUpdate  (on each reactive update)
//   onBeforeDestroy ─→ [removal] ─→ onDestroy
//   onError — wraps component render & effects
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ComponentContext — holds lifecycle callbacks for one component instance
// ---------------------------------------------------------------------------

class ComponentContext {
  constructor() {
    this.beforeMount = [];
    this.mounted = [];
    this.beforeUpdate = [];
    this.updated = [];
    this.beforeDestroy = [];
    this.destroyed = [];
    this.errorHandlers = [];
    this.disposers = []; // effect dispose functions owned by this component
    this.nodes = null; // DOM nodes owned by this component
    this.parent = null; // parent context
    this.children = []; // child component contexts
    this._isMounted = false;
    this._isDestroyed = false;
  }

  /** Run all callbacks in an array, with optional error boundary. */
  _run(callbacks, ...args) {
    for (const fn of callbacks) {
      try {
        fn(...args);
      } catch (err) {
        this._handleError(err);
      }
    }
  }

  /** Handle an error — delegate to error handlers, or rethrow. */
  _handleError(err) {
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
// Context stack — tracks the currently executing component so hooks can
// register without needing an explicit reference.
// ---------------------------------------------------------------------------

const contextStack = [];

export function getCurrentContext() {
  return contextStack[contextStack.length - 1] || null;
}

function pushContext(ctx) {
  contextStack.push(ctx);
}

function popContext() {
  return contextStack.pop();
}

// ---------------------------------------------------------------------------
// Lifecycle hook registration functions
// ---------------------------------------------------------------------------

export function onBeforeMount(fn) {
  const ctx = getCurrentContext();
  if (ctx) ctx.beforeMount.push(fn);
}

export function onMount(fn) {
  const ctx = getCurrentContext();
  if (ctx) ctx.mounted.push(fn);
}

export function onBeforeUpdate(fn) {
  const ctx = getCurrentContext();
  if (ctx) ctx.beforeUpdate.push(fn);
}

export function onUpdate(fn) {
  const ctx = getCurrentContext();
  if (ctx) ctx.updated.push(fn);
}

export function onBeforeDestroy(fn) {
  const ctx = getCurrentContext();
  if (ctx) ctx.beforeDestroy.push(fn);
}

export function onDestroy(fn) {
  const ctx = getCurrentContext();
  if (ctx) ctx.destroyed.push(fn);
}

export function onError(fn) {
  const ctx = getCurrentContext();
  if (ctx) ctx.errorHandlers.push(fn);
}

// ---------------------------------------------------------------------------
// mount(component, container) — instantiate a component and attach to DOM
//
//   mount(Counter, document.getElementById('app'));
//   mount(() => html`<p>Hello</p>`, document.body);
//
// Returns an object with an `unmount()` method to tear down the component.
// ---------------------------------------------------------------------------

export function mount(component, container) {
  const ctx = new ComponentContext();
  const parentCtx = getCurrentContext();
  if (parentCtx) {
    ctx.parent = parentCtx;
    parentCtx.children.push(ctx);
  }

  pushContext(ctx);

  let fragment;
  try {
    fragment = component();
  } catch (err) {
    popContext();
    ctx._handleError(err);
    return { unmount: () => {} };
  }

  popContext();

  // Collect the top-level nodes so we can remove them on unmount
  if (fragment instanceof DocumentFragment) {
    ctx.nodes = Array.from(fragment.childNodes);
  } else if (fragment instanceof Node) {
    ctx.nodes = [fragment];
  } else {
    ctx.nodes = [];
  }

  // --- onBeforeMount ---
  ctx._run(ctx.beforeMount);

  // --- Insert into DOM ---
  if (container && fragment) {
    container.appendChild(fragment);
  }

  ctx._isMounted = true;

  // --- onMount ---
  // Use microtask to ensure DOM is settled
  queueMicrotask(() => {
    ctx._run(ctx.mounted);
  });

  return {
    unmount: () => unmountContext(ctx, container),
    context: ctx,
  };
}

// ---------------------------------------------------------------------------
// unmountContext — tear down a component and its children
// ---------------------------------------------------------------------------

function unmountContext(ctx, container) {
  if (ctx._isDestroyed) return;

  // --- onBeforeDestroy ---
  ctx._run(ctx.beforeDestroy);

  // Recursively unmount children first
  for (const child of ctx.children) {
    unmountContext(child);
  }

  // Remove DOM nodes
  if (ctx.nodes) {
    for (const node of ctx.nodes) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    }
  }

  // Dispose all effects owned by this component
  for (const dispose of ctx.disposers) {
    try {
      dispose();
    } catch (err) {
      ctx._handleError(err);
    }
  }

  ctx._isDestroyed = true;
  ctx._isMounted = false;

  // --- onDestroy ---
  ctx._run(ctx.destroyed);

  // Remove from parent's children list
  if (ctx.parent) {
    const idx = ctx.parent.children.indexOf(ctx);
    if (idx !== -1) ctx.parent.children.splice(idx, 1);
  }
}

// ---------------------------------------------------------------------------
// notifyBeforeUpdate / notifyUpdate — called by the reactive render system
// around DOM patches so lifecycle hooks fire.
// ---------------------------------------------------------------------------

export function notifyBeforeUpdate(ctx) {
  if (ctx && ctx._isMounted && !ctx._isDestroyed) {
    ctx._run(ctx.beforeUpdate);
  }
}

export function notifyUpdate(ctx) {
  if (ctx && ctx._isMounted && !ctx._isDestroyed) {
    ctx._run(ctx.updated);
  }
}
