// ---------------------------------------------------------------------------
// resizeSignal(target, options?) — ResizeObserver as a signal. ADR 0040.
//
// Server: returns `compute(() => ZERO_RECT)`. No observer attached.
// Client: instantiates one ResizeObserver per call, observes `target`.
//         Initial value is `target.getBoundingClientRect()` so callers
//         don't see a zero rect on first read; subsequent values come
//         from each entry's `contentRect`.
// ---------------------------------------------------------------------------

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
  const initial = target.getBoundingClientRect() as DOMRectReadOnly;
  const inner = state<DOMRectReadOnly>(initial);
  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) inner(entry.contentRect);
  });
  observer.observe(target, options);
  return compute(() => inner());
}
