// ---------------------------------------------------------------------------
// ComponentContext & Scope — platform-agnostic ownership tree
// ---------------------------------------------------------------------------

declare const console: {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

export interface Scope {
  disposers?: (() => void)[] | null;
  /** Lean scopes that run after their component rendered (an effect re-running
   *  in a later flush) record the component they belong to. */
  component?: ComponentContext | null;
}

let contextStack: Scope[] = [];

export class ComponentContext implements Scope {
  declare mounted?: (() => void)[] | null;
  declare destroyed?: (() => void)[] | null;
  declare errorHandlers?: ((err: unknown) => void)[] | null;
  declare disposers?: (() => void)[] | null;
  declare nodes?: any[] | null;
  declare parent?: ComponentContext | null;
  declare children?: ComponentContext[] | null;
  declare _isMounted?: boolean;
  declare _isDestroyed?: boolean;
  // Only failed factory teardown sets this flag; lean-owned descendants inherit it.
  declare _rollback?: boolean;
  declare _slotContent?: unknown;
  // Platform-specific extensions (_internals, _stateRefs, _form*, _shadowRoot, _ssr*)
  // are attached lazily by @purityjs/core and @purityjs/ssr with zero base allocation.
  declare _internals?: any;
  declare _stateRefs?: Map<string, number> | null;
  declare _shadowRoot?: unknown;
  declare _ssrSlots?: unknown;
  declare _ssrStyles?: string[];
  declare _formAssociated?: ((form: any) => void)[] | null;
  declare _formDisabled?: ((disabled: boolean) => void)[] | null;
  declare _formReset?: (() => void)[] | null;
  declare _formStateRestore?: ((state: any, mode: 'restore' | 'autocomplete') => void)[] | null;

  _handleError(err: unknown): void {
    // Scoped onError removal can leave an empty array; treat it as no handler.
    const handlers = this.errorHandlers;
    if (handlers?.length) {
      // Recovery work belongs to the component whose handlers receive the
      // error, even when a descendant or a later scheduled effect failed.
      // Teardown errors can still use handlers until their list is released,
      // but must not restore an already destroyed component as a live owner.
      const scoped = !this._isDestroyed;
      if (scoped) pushContext(this);
      try {
        // A handler can unmount this component and release the callback list.
        for (let i = 0; i < handlers.length && this.errorHandlers === handlers; i++) {
          try {
            handlers[i](err);
          } catch (e) {
            console.error('[Purity] Error in onError handler:', e);
          }
        }
      } finally {
        if (scoped) popContext();
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

/** Run shared work without capturing a caller's disposal or component owner. @internal */
export function withoutScope<T>(fn: () => T): T {
  const previous = contextStack;
  contextStack = [];
  try {
    return fn();
  } finally {
    contextStack = previous;
  }
}

export function getCurrentContext(): Scope | null {
  return contextStack[contextStack.length - 1] || null;
}

/**
 * Nearest enclosing component render context. Lean scopes pushed above it
 * (each() rows, match() branches, running effects) own disposal but must not
 * hide the component from component-only APIs (lifecycle hooks, css(),
 * internals, custom states). @internal
 */
export function getCurrentComponent(): ComponentContext | null {
  for (let i = contextStack.length - 1; i >= 0; i--) {
    const ctx = contextStack[i];
    const component = ctx instanceof ComponentContext ? ctx : ctx.component;
    if (component) return component;
  }
  return null;
}

/**
 * Attach a new child context to the current owner. A component owner tracks it
 * as a child (and is its error parent). A lean scope (row, branch, effect)
 * disposes it, and the nearest component becomes its error parent.
 * @internal
 */
export function attachToOwner(
  ctx: ComponentContext,
  unmount: (ctx: ComponentContext) => void,
): void {
  const owner = getCurrentContext();
  if (owner instanceof ComponentContext) {
    ctx.parent = owner;
    (owner.children ??= []).push(ctx);
  } else if (owner) {
    ctx.parent = getCurrentComponent();
    (owner.disposers ??= []).push(() => unmount(ctx));
  }
}

export function pushContext(ctx: Scope): void {
  contextStack.push(ctx);
}

export function popContext(): Scope | undefined {
  return contextStack.pop();
}
