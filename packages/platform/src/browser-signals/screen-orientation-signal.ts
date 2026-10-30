// ---------------------------------------------------------------------------
// screenOrientationSignal() — 'portrait' | 'landscape'. ADR 0041.
//
// Reads `screen.orientation.type` and maps the four-state value down to
// 'portrait' / 'landscape'. Falls back to `innerWidth > innerHeight` when
// `screen.orientation` is unavailable (older iOS Safari). Listens to the
// `change` event on `screen.orientation`, with a legacy
// `orientationchange` fallback and finally a `resize` fallback.
// ---------------------------------------------------------------------------

import { bindListeners } from './listen.ts';
import { compute, state, type ComputedAccessor } from '@purityjs/signals';
import { isSSR } from './ssr.ts';

let singleton: ComputedAccessor<'portrait' | 'landscape'> | null = null;
// Detach for whichever tier's listener bound; null when none bound.
let unbind: (() => void) | null = null;
// Once the modern Screen Orientation API has misbehaved (addEventListener
// threw, type getter threw, etc.) we permanently distrust it for this
// session — otherwise the type getter would still drive derivation while
// listeners are bound to the resize fallback, and the value would never
// actually update on viewport change.
let modernApiDistrusted = false;

function deriveOrientation(): 'portrait' | 'landscape' {
  // Guard the type getter — some legacy / hostile engines throw on access.
  if (!modernApiDistrusted) {
    try {
      if (typeof screen !== 'undefined' && screen.orientation) {
        const t = screen.orientation.type;
        if (typeof t === 'string' && t.length > 0) {
          return t.startsWith('portrait') ? 'portrait' : 'landscape';
        }
      }
    } catch (err) {
      modernApiDistrusted = true;
      console.error(
        '[purity] screenOrientationSignal: reading screen.orientation.type failed; falling back to viewport dimensions:',
        err,
      );
    }
  }
  if (typeof window !== 'undefined') {
    const h = typeof window.innerHeight === 'number' ? window.innerHeight : 0;
    const w = typeof window.innerWidth === 'number' ? window.innerWidth : 0;
    return h >= w ? 'portrait' : 'landscape';
  }
  return 'portrait';
}

/**
 * Reactive screen orientation (ADR 0041).
 *
 * - **Server.** Returns a constant `'portrait'`.
 * - **Client.** Reads `screen.orientation.type` (with `innerWidth` /
 *   `innerHeight` fallback). Listens to `screen.orientation` `change`,
 *   falling back to the legacy `window.orientationchange` event, then
 *   to `resize` when neither is available.
 */
export function screenOrientationSignal(): ComputedAccessor<'portrait' | 'landscape'> {
  if (isSSR() || typeof window === 'undefined') {
    return compute(() => 'portrait' as const);
  }
  if (singleton) return singleton;
  const inner = state(deriveOrientation());
  const refresh = (): void => {
    inner(deriveOrientation());
  };
  singleton = compute(() => inner());

  // Tier 1: modern Screen Orientation API. A failed bind means the API is
  // broken on this engine: distrust the type getter so derivation uses the
  // viewport fallback that the next tiers will drive, and re-seed the state.
  if (typeof screen !== 'undefined' && typeof screen.orientation?.addEventListener === 'function') {
    unbind = bindListeners([[screen.orientation, 'change', refresh]], 'screenOrientationSignal');
    if (!unbind) {
      modernApiDistrusted = true;
      inner(deriveOrientation());
    }
  }
  // Tier 2: legacy `orientationchange` window event (older iOS Safari).
  if (!unbind && typeof window.addEventListener === 'function' && 'onorientationchange' in window) {
    unbind = bindListeners([[window, 'orientationchange', refresh]], 'screenOrientationSignal');
  }
  // Tier 3: resize fallback. If it also fails the accessor stays live but frozen.
  if (!unbind && typeof window.addEventListener === 'function') {
    unbind = bindListeners([[window, 'resize', refresh]], 'screenOrientationSignal');
  }
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * orientation / orientationchange / resize listener so subsequent test
 * runs start clean. */
export function _resetScreenOrientationSignal(): void {
  unbind?.();
  unbind = null;
  singleton = null;
  modernApiDistrusted = false;
}
