// ---------------------------------------------------------------------------
// prefersContrastSignal() — 'no-preference' | 'more' | 'less' | 'custom'.
// ADR 0041.
//
// Reads three media queries via mediaSignal (ADR 0040) through the shared
// preferenceSignal() scaffolding and reduces to a discriminated value.
// Server returns a constant 'no-preference'.
// ---------------------------------------------------------------------------

import { preferenceSignal } from './preference-signal.ts';
import type { ComputedAccessor } from './signals.ts';

export type ContrastPreference = 'no-preference' | 'more' | 'less' | 'custom';

/**
 * Reactive `prefers-contrast` (ADR 0041).
 *
 * - **Server.** Returns a constant `'no-preference'`.
 * - **Client.** Reads `(prefers-contrast: more|less|custom)` via three
 *   `mediaSignal` queries and reduces to the discriminated value.
 *
 * Precedence when a hostile UA reports more than one query as matching
 * (the CSS spec says they're mutually exclusive, but legacy and bridged
 * runtimes can violate that): `more` > `less` > `custom`. `more` wins
 * because it's the strongest accessibility signal; `custom` is the
 * weakest because it only indicates a user-defined palette, not a
 * magnitude.
 */
export function prefersContrastSignal(): ComputedAccessor<ContrastPreference> {
  return preferenceSignal<ContrastPreference>(
    ['(prefers-contrast: more)', '(prefers-contrast: less)', '(prefers-contrast: custom)'],
    ([more, less, custom]) => (more ? 'more' : less ? 'less' : custom ? 'custom' : 'no-preference'),
    'no-preference',
    'prefersContrastSignal',
  );
}
