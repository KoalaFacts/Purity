// ---------------------------------------------------------------------------
// screenOrientationSignal() — 'portrait' | 'landscape'. ADR 0041.
//
// Reads `screen.orientation.type` and maps the four-state value down to
// 'portrait' / 'landscape'. Falls back to `innerWidth > innerHeight` when
// `screen.orientation` is unavailable (older iOS Safari). Listens to the
// `change` event on `screen.orientation`, with a legacy
// `orientationchange` fallback and finally a `resize` fallback.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<'portrait' | 'landscape'> | null = null;
// Track which target the listener landed on so reset can remove it.
let boundRefresh: (() => void) | null = null;
let boundTarget: 'orientation' | 'orientationchange' | 'resize' | null = null;
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
  if (getSSRRenderContext() !== null || typeof window === 'undefined') {
    return compute(() => 'portrait' as const);
  }
  if (singleton) return singleton;
  const inner = state(deriveOrientation());
  const refresh = (): void => {
    inner(deriveOrientation());
  };
  // Publish the singleton + handler ref BEFORE attaching listeners, so a
  // throw from addEventListener cannot leave the module in a half-bound
  // state (one listener attached, refs lost ⇒ leak on reset).
  boundRefresh = refresh;
  singleton = compute(() => inner());

  // Tier 1: modern Screen Orientation API.
  if (typeof screen !== 'undefined' && typeof screen.orientation?.addEventListener === 'function') {
    try {
      screen.orientation.addEventListener('change', refresh);
      boundTarget = 'orientation';
      return singleton;
    } catch (err) {
      console.error(
        '[purity] screenOrientationSignal: screen.orientation.addEventListener failed; falling back:',
        err,
      );
      // Best-effort detach in case the listener half-registered.
      try {
        screen.orientation.removeEventListener('change', refresh);
      } catch {
        /* noop */
      }
      // The modern API is broken on this engine — make derivation use the
      // viewport-dimension fallback so fallback events actually move the
      // value. Refresh the seeded state too: the initial read above may
      // have used the (still-trusted) type getter.
      modernApiDistrusted = true;
      inner(deriveOrientation());
    }
  }

  // Tier 2: legacy `orientationchange` window event (older iOS Safari).
  if (typeof window.addEventListener === 'function' && 'onorientationchange' in window) {
    try {
      window.addEventListener('orientationchange', refresh);
      boundTarget = 'orientationchange';
      return singleton;
    } catch (err) {
      console.error(
        '[purity] screenOrientationSignal: window.addEventListener("orientationchange") failed; falling back to resize:',
        err,
      );
      try {
        window.removeEventListener('orientationchange', refresh);
      } catch {
        /* noop */
      }
    }
  }

  // Tier 3: resize fallback.
  if (typeof window.addEventListener === 'function') {
    try {
      window.addEventListener('resize', refresh);
      boundTarget = 'resize';
      return singleton;
    } catch (err) {
      console.error(
        '[purity] screenOrientationSignal: window.addEventListener("resize") failed; accessor will be frozen at initial value:',
        err,
      );
      try {
        window.removeEventListener('resize', refresh);
      } catch {
        /* noop */
      }
    }
  }

  // No usable listener target — keep the accessor live but frozen.
  boundTarget = null;
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * orientation / orientationchange / resize listener so subsequent test
 * runs start clean. */
export function _resetScreenOrientationSignal(): void {
  if (boundRefresh) {
    try {
      if (boundTarget === 'orientation' && typeof screen !== 'undefined') {
        screen.orientation?.removeEventListener('change', boundRefresh);
      } else if (boundTarget === 'orientationchange' && typeof window !== 'undefined') {
        window.removeEventListener('orientationchange', boundRefresh);
      } else if (boundTarget === 'resize' && typeof window !== 'undefined') {
        window.removeEventListener('resize', boundRefresh);
      }
    } catch (err) {
      console.error('[purity] screenOrientationSignal: detach during reset failed:', err);
    }
  }
  boundRefresh = null;
  boundTarget = null;
  singleton = null;
  modernApiDistrusted = false;
}
