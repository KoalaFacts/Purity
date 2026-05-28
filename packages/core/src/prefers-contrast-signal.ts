// ---------------------------------------------------------------------------
// prefersContrastSignal() — 'no-preference' | 'more' | 'less' | 'custom'.
// ADR 0041.
//
// Reads three media queries via mediaSignal (ADR 0040) and reduces to a
// discriminated value. Server returns a constant 'no-preference'.
// ---------------------------------------------------------------------------

import { mediaSignal } from './media-signal.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export type ContrastPreference = 'no-preference' | 'more' | 'less' | 'custom';

/**
 * Reactive `prefers-contrast` (ADR 0041).
 *
 * - **Server.** Returns a constant `'no-preference'`.
 * - **Client.** Reads `(prefers-contrast: more|less|custom)` via three
 *   `mediaSignal` queries and reduces to the discriminated value.
 */
export function prefersContrastSignal(): ComputedAccessor<ContrastPreference> {
  if (getSSRRenderContext() !== null) return compute(() => 'no-preference' as const);
  const more = mediaSignal('(prefers-contrast: more)');
  const less = mediaSignal('(prefers-contrast: less)');
  const custom = mediaSignal('(prefers-contrast: custom)');
  return compute<ContrastPreference>(() => {
    if (more()) return 'more';
    if (less()) return 'less';
    if (custom()) return 'custom';
    return 'no-preference';
  });
}
