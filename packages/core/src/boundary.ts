// ---------------------------------------------------------------------------
// errorBoundary(view, fallback) — client error fallback with reset (ADR 0054)
//
// Opt-in entry `@purityjs/core/boundary`. Errors from the view's render and
// from later scheduled runs of its watches/effects (a template binding reading
// a computed that throws, for example) replace the view's DOM with
// `fallback(error, reset)`. While that fallback is shown, `reset()` disposes it and renders the
// view again. A throwing fallback goes to the next outer boundary or the
// component's `onError` chain. Event-handler errors are not caught.
// ---------------------------------------------------------------------------

import {
  ComponentContext,
  disposeScope,
  getCurrentComponent,
  getCurrentContext,
  popContext,
  pushContext,
} from '@purityjs/signals';
import { scheduleMountCallbacks, unmountContext } from './component.ts';
import { ENABLE_SSR, isHydratingPassive } from './hooks.ts';
import { getSSRRenderContext } from './ssr/state.ts';

/** Fallback view: receives the error and a `reset()` that renders the view again. */
export type ErrorFallback = (error: unknown, reset: () => void) => unknown;

/**
 * Render `view`; if it throws while rendering, or one of its watches throws
 * later, replace its DOM with `fallback(error, reset)`.
 *
 * On the server the view renders inside `try`/`catch` and the fallback
 * replaces it on a synchronous throw. During hydration this first slice
 * hydrates the view without a boundary (errors reach `onError`).
 */
export function errorBoundary(view: () => unknown, fallback: ErrorFallback): DocumentFragment {
  if (ENABLE_SSR && getSSRRenderContext()) {
    try {
      return view() as DocumentFragment;
    } catch (error) {
      return fallback(error, noop) as DocumentFragment;
    }
  }
  if (isHydratingPassive()) return view() as DocumentFragment;

  const start = document.createComment('eb');
  const end = document.createComment('/eb');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(start);
  fragment.appendChild(end);

  const parent = getCurrentComponent();
  let current: ComponentContext | null = null;
  let disposed = false;

  const clear = (): void => {
    const owner = current;
    current = null;
    if (owner) unmountContext(owner);
    const container = end.parentNode;
    if (!container) return;
    for (let node = start.nextSibling; node && node !== end; node = start.nextSibling) {
      container.removeChild(node);
    }
  };

  // Each attempt (view or fallback) gets its own owner whose error parent is
  // the surrounding component, so a fallback failure escapes this boundary.
  // It forwards host fields to that component, so slot(), css(), internals(),
  // custom states and form hooks inside the boundary see the real host.
  const run = (render: () => unknown, handle: ((error: unknown) => void) | null): unknown => {
    const owner = parent ? (new HostedContext(parent) as ComponentContext) : new ComponentContext();
    owner.parent = parent;
    if (handle) owner.errorHandlers = [handle];
    current = owner;
    pushContext(owner);
    try {
      return render();
    } finally {
      popContext();
    }
  };

  // Insert the attempt's content, or, when the attempt was replaced while it
  // rendered (a nested failure or a reset from inside the fallback), release
  // what it registered after it was torn down.
  const show = (owner: ComponentContext, content: unknown): void => {
    if (current === owner) {
      if (content != null) {
        end.parentNode!.insertBefore(
          content instanceof Node ? content : document.createTextNode(String(content)),
          end,
        );
      }
      owner._isMounted = true;
      scheduleMountCallbacks(owner);
      return;
    }
    const children = owner.children;
    owner.children = null;
    if (children) for (let i = 0; i < children.length; i++) unmountContext(children[i]);
    owner.mounted = null;
    disposeScope(owner);
  };

  const fail = (failed: ComponentContext, error: unknown): void => {
    // A stale attempt (already replaced or disposed) has nothing left to show.
    if (disposed || current !== failed) return;
    clear();
    let shown: ComponentContext | null = null;
    // Only the fallback that is still shown can reset; a stale reset is a no-op.
    const reset = (): void => {
      if (disposed || current !== shown) return;
      clear();
      renderView();
    };
    let content: unknown;
    try {
      content = run(() => {
        shown = current;
        return fallback(error, reset);
      }, null);
    } catch (fallbackError) {
      if (current === shown) clear();
      if (parent) parent._handleError(fallbackError);
      else throw fallbackError;
      return;
    }
    show(shown!, content);
  };

  const renderView = (): void => {
    let attempt: ComponentContext | null = null;
    const handle = (error: unknown): void => fail(attempt!, error);
    let content: unknown = null;
    try {
      content = run(() => {
        attempt = current;
        return view();
      }, handle);
    } catch (error) {
      // After a nested failure already replaced this attempt, the render's own
      // throw is a consequence of it; show() releases the attempt's late work.
      if (current === attempt) {
        fail(attempt!, error);
        return;
      }
    }
    show(attempt!, content);
  };

  renderView();

  const owner = getCurrentContext();
  if (owner) {
    (owner.disposers ??= []).push(() => {
      disposed = true;
      clear();
      start.parentNode?.removeChild(start);
      end.parentNode?.removeChild(end);
    });
  }
  return fragment;
}

function noop(): void {}

// Component fields that belong to the host element, not to an ownership scope.
const HOST_FIELDS = [
  '_internals',
  '_stateRefs',
  '_shadowRoot',
  '_slotContent',
  '_ssrSlots',
  '_ssrStyles',
  '_formAssociated',
  '_formDisabled',
  '_formReset',
  '_formStateRestore',
] as const;

class HostedContext extends ComponentContext {
  declare _host: ComponentContext;
  constructor(host: ComponentContext) {
    super();
    this._host = host;
  }
}

for (let i = 0; i < HOST_FIELDS.length; i++) {
  const key = HOST_FIELDS[i];
  Object.defineProperty(HostedContext.prototype, key, {
    get(this: HostedContext) {
      return this._host[key];
    },
    set(this: HostedContext, value: unknown) {
      (this._host as unknown as Record<string, unknown>)[key] = value;
    },
  });
}
