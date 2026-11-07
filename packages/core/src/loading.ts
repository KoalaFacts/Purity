// ---------------------------------------------------------------------------
// loading(view, fallback) — client loading boundary (ADR 0057, SV2-004)
//
// Opt-in entry `@purityjs/core/loading`. While the view's first render reads
// an unresolved asyncCompute() value (a PendingError), the boundary shows
// `fallback()` and renders the view again once that value settles. After the
// view is shown it stays: a refetch keeps the retained value, so the DOM and
// its edited input state survive. Other errors pass to the surrounding
// errorBoundary()/onError chain.
// ---------------------------------------------------------------------------

import {
  ComponentContext,
  disposeScope,
  getCurrentComponent,
  getCurrentContext,
  popContext,
  pushContext,
  watch,
} from '@purityjs/signals';
import { isPending } from './async.ts';
import { scheduleMountCallbacks, unmountContext } from './component.ts';
import { ENABLE_SSR, isHydratingPassive } from './hooks.ts';
import { HostedContext } from './hosted-context.ts';
import { getSSRRenderContext } from './ssr/state.ts';

/**
 * Render `view`; while its first render reads an unresolved `asyncCompute()`
 * value, show `fallback()` instead and render `view` again when the value
 * settles.
 *
 * On the server the fallback replaces a view that reads an unresolved value.
 * During hydration this first slice hydrates the view without a boundary.
 */
export function loading(view: () => unknown, fallback: () => unknown): DocumentFragment {
  if (ENABLE_SSR && getSSRRenderContext()) {
    try {
      return view() as DocumentFragment;
    } catch (error) {
      if (!isPending(error)) throw error;
      return fallback() as DocumentFragment;
    }
  }
  if (isHydratingPassive()) return view() as DocumentFragment;

  const start = document.createComment('ld');
  const end = document.createComment('/ld');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(start);
  fragment.appendChild(end);

  const parent = getCurrentComponent();
  // The owner of what is shown: the fallback until the view is revealed.
  let current: ComponentContext | null = null;
  let showingFallback = false;
  let stop: (() => void) | null = null;
  let disposed = false;

  const release = (owner: ComponentContext): void => {
    unmountContext(owner);
    owner.mounted = null;
    disposeScope(owner);
  };

  const clear = (): void => {
    const owner = current;
    current = null;
    if (owner) release(owner);
    for (let node = start.nextSibling; node && node !== end; node = start.nextSibling) {
      (node as ChildNode).remove();
    }
  };

  // Renders in a fresh owner whose errors reach the surrounding component;
  // a throwing render releases what it registered.
  const run = (render: () => unknown): [ComponentContext, unknown] => {
    const owner = parent ? (new HostedContext(parent) as ComponentContext) : new ComponentContext();
    owner.parent = parent;
    pushContext(owner);
    let rendered = false;
    try {
      const content = render();
      rendered = true;
      return [owner, content];
    } finally {
      popContext();
      if (!rendered) release(owner);
    }
  };

  const show = ([owner, content]: [ComponentContext, unknown]): void => {
    clear();
    current = owner;
    if (content != null) {
      end.parentNode!.insertBefore(
        content instanceof Node ? content : document.createTextNode(String(content)),
        end,
      );
    }
    owner._isMounted = true;
    scheduleMountCallbacks(owner);
  };

  // Renders the view; on an unresolved read shows the fallback (once) and
  // waits for the value that threw to settle.
  const attempt = (): void => {
    let rendered: [ComponentContext, unknown];
    try {
      rendered = run(view);
    } catch (error) {
      if (!isPending(error)) throw error;
      if (!showingFallback) {
        show(run(fallback));
        showingFallback = true;
      }
      const source = error.source;
      // Without a live source (a hand-made PendingError, or a disposed
      // value) nothing will settle: the fallback stays.
      if (!source?.pending()) return;
      let first = true;
      stop = watch(() => {
        if (source.pending() || first) {
          first = false;
          return;
        }
        queueMicrotask(retry);
      });
      return;
    }
    showingFallback = false;
    show(rendered);
  };

  const retry = (): void => {
    stop?.();
    stop = null;
    if (disposed) return;
    try {
      attempt();
    } catch (error) {
      // A rejection (or other failure) of the re-render goes where an error
      // from a later scheduled run would: the surrounding onError chain.
      clear();
      try {
        if (!parent) throw error;
        parent._handleError(error);
      } catch (unhandled) {
        console.error('[Purity] loading() view threw:', unhandled);
      }
    }
  };

  attempt();

  const owner = getCurrentContext();
  if (owner) {
    (owner.disposers ??= []).push(() => {
      disposed = true;
      stop?.();
      stop = null;
      clear();
      start.remove();
      end.remove();
    });
  }
  return fragment;
}
