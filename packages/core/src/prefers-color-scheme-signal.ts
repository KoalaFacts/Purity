// ---------------------------------------------------------------------------
// prefersColorSchemeSignal() — 'light' | 'dark'. ADR 0041.
//
// Composes on top of mediaSignal('(prefers-color-scheme: dark)') (ADR 0040)
// via the shared preferenceSignal() scaffolding.
// Server returns a constant 'light'.
// ---------------------------------------------------------------------------

import { preferenceSignal } from './preference-signal.ts';
import type { ComputedAccessor } from './signals.ts';

/**
 * Reactive `prefers-color-scheme` (ADR 0041).
 *
 * - **Server.** Returns a constant `'light'`.
 * - **Client.** Reads `(prefers-color-scheme: dark)` via `mediaSignal` and
 *   maps the boolean to `'dark'` / `'light'`. Shares the `mediaSignal`
 *   cache, so importing the raw query elsewhere reuses one listener.
 *
 * Throw isolation and the missing-API fallback are handled by the shared
 * `preferenceSignal()` scaffolding — both the initial `mediaSignal()` call
 * and every subsequent accessor read collapse to a constant `'light'`
 * rather than crashing the caller.
 */
export function prefersColorSchemeSignal(): ComputedAccessor<'light' | 'dark'> {
  return preferenceSignal(
    ['(prefers-color-scheme: dark)'],
    ([dark]) => (dark ? 'dark' : 'light'),
    'light',
    'prefersColorSchemeSignal',
  );
}
