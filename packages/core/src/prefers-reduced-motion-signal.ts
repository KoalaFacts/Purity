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
  // Throw isolation: a hostile global, malformed query injection, or a
  // broken `mediaSignal` upgrade path must never crash the caller. Worst
  // case we degrade to the SSR-equivalent constant `false`.
  let mq: ComputedAccessor<boolean>;
  try {
    mq = mediaSignal('(prefers-reduced-motion: reduce)');
  } catch (err) {
    console.error(
      '[purity] prefersReducedMotionSignal: mediaSignal threw, defaulting to false:',
      err,
    );
    return compute(() => false);
  }
  // Strict boolean coercion. `mq()` is typed as boolean but the underlying
  // `MediaQueryList.matches` is set by the platform (or, in tests, a mock)
  // and engines have historically returned truthy/falsy non-bools. Callers
  // rely on `typeof === 'boolean'` for CSS class flips and `:state()`.
  return compute(() => {
    try {
      // `!!` not `=== true` — engines / mocks may yield truthy non-bools.
      return !!mq();
    } catch (err) {
      console.error('[purity] prefersReducedMotionSignal: read threw, defaulting to false:', err);
      return false;
    }
  });
}
