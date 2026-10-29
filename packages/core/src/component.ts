// ---------------------------------------------------------------------------
// Component context & lifecycle — minimal, like Solid
//
// Only 3 hooks: onMount, onDestroy, onDispose
// Error handling via onError (bubbles up to parent)
// ---------------------------------------------------------------------------

import { disposeScope, watch } from './signals.ts';
import {
  ComponentContext,
  attachToOwner,
  getCurrentComponent,
  getCurrentContext,
  pushContext,
  popContext,
} from './scope.ts';

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

/** @internal Shared no-op handle for a render error consumed by onError. */
export const FAILED_MOUNT_RESULT: MountResult = { unmount: () => {} };

// ---------------------------------------------------------------------------
// Lifecycle hooks — only 3 + error
// ---------------------------------------------------------------------------

// Add a component callback registered from the current owner. A lean scope
// (branch, row, re-running effect) removes it again when disposed, so hidden
// branches don't leave callbacks on the long-lived component.
function addCallback<T>(ctx: ComponentContext, list: T[], fn: T): void {
  list.push(fn);
  const owner = getCurrentContext();
  if (owner && owner !== ctx) {
    (owner.disposers ??= []).push(() => {
      // The component's own teardown keeps it: it runs with the component.
      if (ctx._isDestroyed) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    });
  }
}

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
  const ctx = getCurrentComponent();
  if (!ctx) return;
  if (!ctx._isMounted) {
    addCallback(ctx, (ctx.mounted ??= []), fn);
    return;
  }
  // Registered by a branch first shown after the component mounted: the
  // mount drain already ran, so schedule this one under the current owner.
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
      // A hook can unmount its owner; later hooks must not revive its work.
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
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx.destroyed ??= []), fn);
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
 * Register an error handler. Catches errors from render, lifecycle hooks, and
 * subsequent scheduled runs of component-owned watches/effects. A watch's
 * initial run remains synchronous and throws to its caller.
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
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx.errorHandlers ??= []), fn);
}

// ---------------------------------------------------------------------------
// Form-associated lifecycle hooks — only invoked when the component was
// declared with `component(tag, fn, { formAssociated: true })`. Defined on
// the PurityElement class unconditionally; the browser only dispatches when
// both `static formAssociated = true` and the relevant callback exist on
// the prototype, so non-form components pay nothing.
// ---------------------------------------------------------------------------

/**
 * Register a callback that runs when the host element is associated with
 * (or disassociated from) a `<form>`. Only fires for components declared
 * with `{ formAssociated: true }`.
 *
 * @param fn Receives the new form (or `null` when disassociated).
 */
export function onFormAssociated(fn: (form: HTMLFormElement | null) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formAssociated ??= []), fn);
}

/**
 * Register a callback that runs when the containing form's `disabled` state
 * changes (typically via a `<fieldset disabled>` ancestor). Only fires for
 * components declared with `{ formAssociated: true }`.
 */
export function onFormDisabled(fn: (disabled: boolean) => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formDisabled ??= []), fn);
}

/**
 * Register a callback that runs when the containing form is reset.
 * Components should clear their local state. Only fires for components
 * declared with `{ formAssociated: true }`.
 */
export function onFormReset(fn: () => void): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formReset ??= []), fn);
}

/**
 * Register a callback that runs during form state restoration — both
 * back/forward cache restore and browser autofill. `state` is whatever the
 * component last passed to `internals().setFormValue(value, state)`; `mode`
 * is `'restore'` (bfcache) or `'autocomplete'` (autofill).
 *
 * Only fires for components declared with `{ formAssociated: true }`.
 */
export function onFormStateRestore(
  fn: (state: string | File | FormData | null, mode: 'restore' | 'autocomplete') => void,
): void {
  const ctx = getCurrentComponent();
  if (ctx) addCallback(ctx, (ctx._formStateRestore ??= []), fn);
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
    // A failed render has no usable unmount handle. Keep error propagation
    // intact, but always tear down its subscriptions and completed children.
    // An error handler can unmount the parent while this child is attached.
    // Suppress the failed render's destroy lifecycle before dispatching it.
    ctx.destroyed = null;
    try {
      ctx._handleError(err);
    } finally {
      unmountContext(ctx);
    }
    return FAILED_MOUNT_RESULT;
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
  const ctx = getCurrentComponent();
  if (!ctx) return;
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

  // Release with the current disposal owner (a hidden branch, a removed row),
  // not the host: the host outlives them.
  const owner = getCurrentContext()!;
  (owner.disposers ??= []).push(() => {
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

/** @internal Shared owner teardown; root hydration imports lifecycle, not the reverse. */
export function unmountContext(ctx: ComponentContext): void {
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

  // Mark destroyed before disposers run: lean scopes released by this teardown
  // must not unregister their callbacks from a component that is going away.
  ctx._isDestroyed = true;
  disposeScope(ctx);
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
