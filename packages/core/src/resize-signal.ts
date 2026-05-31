// ---------------------------------------------------------------------------
// resizeSignal(target, options?) — ResizeObserver as a signal. ADR 0040.
//
// Server: returns `compute(() => ZERO_RECT)`. No observer attached.
// Client: instantiates one ResizeObserver per call, observes `target`.
//         Initial value is `target.getBoundingClientRect()` so callers
//         don't see a zero rect on first read; subsequent values come
//         from each entry's `contentRect`.
// ---------------------------------------------------------------------------

import { getCurrentContext } from './component.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

const ZERO_RECT: DOMRectReadOnly = Object.freeze({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON() {
    return this;
  },
}) as DOMRectReadOnly;

/**
 * Reactive `DOMRectReadOnly` for an element via `ResizeObserver`
 * (ADR 0040). Composes with `compute()` to build container-query-
 * style breakpoints in JS:
 *
 * ```ts
 * const rect = resizeSignal(box);
 * const wide = compute(() => rect().width > 600);
 * ```
 *
 * - **Server.** Returns `compute(() => ZERO_RECT)` (a frozen zero rect).
 * - **Client.** Creates one `ResizeObserver` per call, observes `target`.
 *   Initial value is `target.getBoundingClientRect()`; subsequent values
 *   are the entry's `contentRect`.
 */
export function resizeSignal(
  target: Element,
  options?: ResizeObserverOptions,
): ComputedAccessor<DOMRectReadOnly> {
  if (getSSRRenderContext() !== null || typeof ResizeObserver === 'undefined') {
    return compute(() => ZERO_RECT);
  }
  // Seed the initial value from `getBoundingClientRect()` so callers don't
  // observe a zero rect on first read. Detached / exotic elements can throw
  // here (e.g. some custom Element wrappers); fall back to the frozen zero
  // rect rather than crashing the construction. Normalise the live DOMRect
  // into a frozen snapshot so callers cannot mutate the seed value out from
  // under the signal graph.
  let initial: DOMRectReadOnly = ZERO_RECT;
  try {
    const r = target.getBoundingClientRect();
    initial = Object.freeze({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
      toJSON() {
        return this;
      },
    }) as DOMRectReadOnly;
  } catch (e) {
    console.error('[Purity] resizeSignal: getBoundingClientRect threw:', e);
  }
  const inner = state<DOMRectReadOnly>(initial);
  let disposed = false;
  const observer = new ResizeObserver((entries) => {
    if (disposed) return;
    const entry = entries[entries.length - 1];
    // Guard against malformed batches (empty array, missing contentRect on
    // exotic polyfills). Without the guard a downstream null-deref crashed
    // the callback and the browser swallowed it silently.
    if (!entry || !entry.contentRect) return;
    try {
      inner(entry.contentRect);
    } catch (e) {
      // `state()` writes don't normally throw, but downstream eager
      // computeds/watchers feeding through the push graph can. Surfacing
      // through console.error keeps the observer attached for the next batch
      // rather than letting the engine tear it down on an uncaught error.
      console.error('[Purity] resizeSignal: callback threw:', e);
    }
  });
  observer.observe(target, options);
  // Auto-disconnect on the surrounding component's unmount; without this
  // a resizeSignal() inside a component left the observer alive until the
  // accessor was GC'd. Module-scope calls keep "lifetime = page" semantics.
  // The `disposed` flag guards against duplicate disconnect() calls and
  // races where a final batch is delivered after teardown.
  const ctx = getCurrentContext();
  if (ctx)
    (ctx.disposers ??= []).push(() => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
    });
  return compute(() => inner());
}
