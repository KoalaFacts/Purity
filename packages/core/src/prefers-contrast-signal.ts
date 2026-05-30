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

const FALLBACK = (): ContrastPreference => 'no-preference';

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
  if (getSSRRenderContext() !== null) return compute(FALLBACK);

  // Acquire all three accessors up front with throw isolation. If any
  // mediaSignal call throws synchronously (defensive — current impl
  // catches internally, but a wrapper layer could be swapped in), fall
  // back to a constant rather than returning a half-wired accessor that
  // would later throw on read.
  let more: ComputedAccessor<boolean>;
  let less: ComputedAccessor<boolean>;
  let custom: ComputedAccessor<boolean>;
  try {
    more = mediaSignal('(prefers-contrast: more)');
    less = mediaSignal('(prefers-contrast: less)');
    custom = mediaSignal('(prefers-contrast: custom)');
  } catch (err) {
    console.error('[purity] prefersContrastSignal: mediaSignal acquisition failed:', err);
    return compute(FALLBACK);
  }

  return compute<ContrastPreference>(() => {
    // Read each accessor defensively so a throw from one of the three
    // (e.g. a hostile compute body wedged in by a test harness) can't
    // poison the whole reduction. `false` is the safe default — it
    // forces the next branch to be considered.
    let m = false;
    let l = false;
    let c = false;
    try {
      m = more();
    } catch (err) {
      console.error('[purity] prefersContrastSignal: `more` accessor threw:', err);
    }
    try {
      l = less();
    } catch (err) {
      console.error('[purity] prefersContrastSignal: `less` accessor threw:', err);
    }
    try {
      c = custom();
    } catch (err) {
      console.error('[purity] prefersContrastSignal: `custom` accessor threw:', err);
    }
    if (m) return 'more';
    if (l) return 'less';
    if (c) return 'custom';
    return 'no-preference';
  });
}
