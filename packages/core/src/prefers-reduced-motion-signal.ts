// ---------------------------------------------------------------------------
// prefersReducedMotionSignal() — boolean. ADR 0041.
//
// Composes on top of mediaSignal('(prefers-reduced-motion: reduce)') via the
// shared preferenceSignal() scaffolding.
// Server returns a constant `false`.
// ---------------------------------------------------------------------------

import { preferenceSignal } from './preference-signal.ts';
import type { ComputedAccessor } from './signals.ts';

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
  return preferenceSignal(
    ['(prefers-reduced-motion: reduce)'],
    // `!!` not `=== true` — engines / mocks may yield truthy non-bools, and
    // callers rely on `typeof === 'boolean'` for CSS class flips / `:state()`.
    ([reduce]) => !!reduce,
    false,
    'prefersReducedMotionSignal',
  );
}
