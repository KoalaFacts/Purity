// ---------------------------------------------------------------------------
// prefersReducedMotionSignal() — boolean. ADR 0041.
//
// Composes on top of mediaSignal('(prefers-reduced-motion: reduce)').
// Server returns a constant `false`.
// ---------------------------------------------------------------------------

import { mediaSignal } from './media-signal.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Reactive `prefers-reduced-motion` (ADR 0041).
 *
 * - **Server.** Returns a constant `false`.
 * - **Client.** Reads `(prefers-reduced-motion: reduce)` via `mediaSignal`.
 *
 * @example
 * ```ts
 * const reduceMotion = prefersReducedMotionSignal();
 * watch(reduceMotion, (r) => element.style.animation = r ? 'none' : '');
 * ```
 */
export function prefersReducedMotionSignal(): ComputedAccessor<boolean> {
  if (getSSRRenderContext() !== null) return compute(() => false);
  const mq = mediaSignal('(prefers-reduced-motion: reduce)');
  return compute(() => mq());
}
