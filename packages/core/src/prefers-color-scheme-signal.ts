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
 */
export function prefersColorSchemeSignal(): ComputedAccessor<'light' | 'dark'> {
  if (getSSRRenderContext() !== null) return compute(() => 'light' as const);
  const dark = mediaSignal('(prefers-color-scheme: dark)');
  return compute(() => (dark() ? 'dark' : 'light'));
}
