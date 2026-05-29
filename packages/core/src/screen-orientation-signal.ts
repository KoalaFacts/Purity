// ---------------------------------------------------------------------------
// screenOrientationSignal() — 'portrait' | 'landscape'. ADR 0041.
//
// Reads `screen.orientation.type` and maps the four-state value down to
// 'portrait' / 'landscape'. Falls back to `innerWidth > innerHeight` when
// `screen.orientation` is unavailable (older iOS Safari). Listens to the
// `change` event on `screen.orientation`, with a `resize` fallback.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<'portrait' | 'landscape'> | null = null;
// Track which target the listener landed on so reset can remove it.
let boundRefresh: (() => void) | null = null;
let boundTarget: 'orientation' | 'resize' | null = null;

function deriveOrientation(): 'portrait' | 'landscape' {
  if (typeof screen !== 'undefined' && screen.orientation?.type) {
    return screen.orientation.type.startsWith('portrait') ? 'portrait' : 'landscape';
  }
  if (typeof window !== 'undefined') {
    return window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape';
  }
  return 'portrait';
}

/**
 * Reactive screen orientation (ADR 0041).
 *
 * - **Server.** Returns a constant `'portrait'`.
 * - **Client.** Reads `screen.orientation.type` (with `innerWidth` /
 *   `innerHeight` fallback). Listens to `screen.orientation` `change` or
 *   to `resize` when the API is unavailable.
 */
export function screenOrientationSignal(): ComputedAccessor<'portrait' | 'landscape'> {
  if (getSSRRenderContext() !== null || typeof window === 'undefined') {
    return compute(() => 'portrait' as const);
  }
  if (singleton) return singleton;
  const inner = state(deriveOrientation());
  const refresh = (): void => {
    inner(deriveOrientation());
  };
  boundRefresh = refresh;
  if (typeof screen !== 'undefined' && screen.orientation?.addEventListener) {
    boundTarget = 'orientation';
    screen.orientation.addEventListener('change', refresh);
  } else if (typeof window.addEventListener === 'function') {
    boundTarget = 'resize';
    window.addEventListener('resize', refresh);
  }
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * orientation / resize listener so subsequent test runs start clean. */
export function _resetScreenOrientationSignal(): void {
  if (boundRefresh) {
    if (boundTarget === 'orientation' && typeof screen !== 'undefined') {
      screen.orientation?.removeEventListener('change', boundRefresh);
    } else if (boundTarget === 'resize' && typeof window !== 'undefined') {
      window.removeEventListener('resize', boundRefresh);
    }
  }
  boundRefresh = null;
  boundTarget = null;
  singleton = null;
}
