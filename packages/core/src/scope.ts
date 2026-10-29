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
  /** Lean scopes that run after their component rendered (an effect re-running
   *  in a later flush) record the component they belong to. */
  component?: ComponentContext | null;
}

let contextStack: Scope[] = [];

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
  // Only failed factory teardown sets this flag; lean-owned descendants inherit it.
  declare _rollback?: boolean;
  // Optional per-instance data stays absent on ordinary components. The
  // declaring class fields otherwise allocate slots for every new owner.
  declare _slotContent: unknown;
  // Set by PurityElement.connectedCallback when the component is a Custom
  // Element. null for plain mount() roots (no host element to attach to).
  declare _internals?: ElementInternals | null;
  // Ref counts per state name. bindComponentState() composes — many sources
  // can drive the same state and the host only flips when count crosses 0↔1.
  declare _stateRefs?: Map<string, number>;
  // Form-associated lifecycle callback arrays. Populated by the onForm*
  // hooks; drained by PurityElement's matching callbacks. All nullable so
  // non-form-associated components pay zero allocation cost.
  declare _formAssociated?: ((form: HTMLFormElement | null) => void)[];
  declare _formDisabled?: ((disabled: boolean) => void)[];
  declare _formReset?: (() => void)[];
  declare _formStateRestore?: ((state: string | File | FormData | null,
    mode: 'restore' | 'autocomplete',
  ) => void)[];

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
