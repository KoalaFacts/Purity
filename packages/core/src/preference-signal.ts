// ---------------------------------------------------------------------------
// Shared scaffolding for `prefers-*` media-preference signals. ADR 0041.
//
// prefersColorSchemeSignal, prefersReducedMotionSignal, and
// prefersContrastSignal each: return an SSR-constant fallback, acquire one
// or more mediaSignal() accessors with throw isolation (falling back to the
// same constant on failure), then expose a compute() that reads every
// accessor UNCONDITIONALLY on each run — so all of them stay subscribed,
// not just whichever one decides the result — each with its own throw
// isolation, before reducing the results to the final value.
// ---------------------------------------------------------------------------

import { mediaSignal } from './media-signal.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export function preferenceSignal<T>(
  queries: readonly string[],
  reduce: (matches: readonly boolean[]) => T,
  fallback: T,
  label: string,
): ComputedAccessor<T> {
  // SSR + non-browser (Node, worker without matchMedia) → the constant
  // mediaSignal() itself would fall back to; checked here too so we never
  // call mediaSignal() at all in that case.
  if (getSSRRenderContext() !== null) return compute(() => fallback);

  // Acquire every accessor up front with throw isolation. mediaSignal()
  // already catches matchMedia construction errors internally, but a
  // hostile `mql.matches` getter throws inside its own `state()` call,
  // outside any try/catch there — wrap the acquisition so the call site
  // never crashes and never returns a half-wired accessor.
  let accessors: ComputedAccessor<boolean>[];
  try {
    accessors = queries.map((q) => mediaSignal(q));
  } catch (err) {
    console.error(`[purity] ${label}: mediaSignal acquisition failed:`, err);
    return compute(() => fallback);
  }

  return compute(() => {
    // Read each accessor defensively so a throw from one can't poison the
    // others or the overall reduction — and read ALL of them, not just
    // until one "wins", so every query stays subscribed regardless of
    // which one ends up deciding the result.
    const matches = accessors.map((accessor, i) => {
      try {
        return accessor();
      } catch (err) {
        console.error(`[purity] ${label}: query ${JSON.stringify(queries[i])} read failed:`, err);
        return false;
      }
    });
    try {
      return reduce(matches);
    } catch (err) {
      console.error(`[purity] ${label}: reduce failed:`, err);
      return fallback;
    }
  });
}
