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
  const refresh = (): void => inner(deriveOrientation());
  if (typeof screen !== 'undefined' && screen.orientation?.addEventListener) {
    screen.orientation.addEventListener('change', refresh);
  } else if (typeof window.addEventListener === 'function') {
    window.addEventListener('resize', refresh);
  }
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. */
export function _resetScreenOrientationSignal(): void {
  singleton = null;
}
