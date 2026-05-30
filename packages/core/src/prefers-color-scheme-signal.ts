// ---------------------------------------------------------------------------
// prefersColorSchemeSignal() — 'light' | 'dark'. ADR 0041.
//
// Composes on top of mediaSignal('(prefers-color-scheme: dark)') (ADR 0040).
// Server returns a constant 'light'.
// ---------------------------------------------------------------------------

import { mediaSignal } from './media-signal.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Reactive `prefers-color-scheme` (ADR 0041).
 *
 * - **Server.** Returns a constant `'light'`.
 * - **Client.** Reads `(prefers-color-scheme: dark)` via `mediaSignal` and
 *   maps the boolean to `'dark'` / `'light'`. Shares the `mediaSignal`
 *   cache, so importing the raw query elsewhere reuses one listener.
 *
 * Robustness:
 * - **Throw isolation.** A hostile `matchMedia` (e.g., a `matches` getter
 *   that throws, or an engine that throws on construction) must never
 *   crash the caller. Both the initial `mediaSignal()` call and every
 *   subsequent accessor read are wrapped — failures collapse to a
 *   constant `'light'`, matching the SSR / no-API fallback.
 * - **Missing-API fallback.** Skips `mediaSignal` entirely when `window`
 *   or `window.matchMedia` is absent, returning a constant `'light'`
 *   accessor without polluting the `mediaSignal` cache.
 * - **Return value normalization.** The mapper coerces `dark()` strictly
 *   to `'dark' | 'light'` — never returns a raw boolean or other value
 *   even if a custom `mediaSignal` implementation yields one.
 */
export function prefersColorSchemeSignal(): ComputedAccessor<'light' | 'dark'> {
  // SSR + non-browser (Node, worker without matchMedia) → constant 'light'.
  // Checking window guards before mediaSignal() avoids creating cache entries
  // for queries we know we can't observe, and keeps the failure mode uniform.
  if (
    getSSRRenderContext() !== null ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return compute(() => 'light' as const);
  }
  // mediaSignal() catches matchMedia construction errors itself, but a
  // hostile `mql.matches` getter throws inside its `state(mql.matches)` call
  // — outside any try/catch there. Wrap the setup so the call site never
  // crashes; fall back to a constant accessor on failure.
  let dark: ComputedAccessor<boolean>;
  try {
    dark = mediaSignal('(prefers-color-scheme: dark)');
  } catch (err) {
    console.error('[purity] prefersColorSchemeSignal: mediaSignal setup failed:', err);
    return compute(() => 'light' as const);
  }
  // Reads can also throw if the underlying signal graph is corrupted by a
  // hostile environment — collapse to 'light' rather than propagating.
  return compute(() => {
    try {
      return dark() ? ('dark' as const) : ('light' as const);
    } catch (err) {
      console.error('[purity] prefersColorSchemeSignal: read failed:', err);
      return 'light' as const;
    }
  });
}
