// ---------------------------------------------------------------------------
// devicePixelRatioSignal() — reactive `window.devicePixelRatio`. ADR 0041.
//
// DPR changes (zoom, monitor drag) don't fire a dedicated event. The
// idiomatic way to observe them is to attach a `change` listener to
// `matchMedia('(resolution: ${current}dppx)')` — when that query stops
// matching, DPR has changed. We then re-read DPR and re-bind against the
// new value.
//
// Server: returns `compute(() => 1)`.
// Client: lazy singleton with the re-bind dance described above.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<number> | null = null;

/**
 * Reactive `window.devicePixelRatio` (ADR 0041).
 *
 * - **Server.** Returns a constant `1`.
 * - **Client.** Singleton. Re-binds to a fresh `(resolution: Xdppx)`
 *   query every time DPR changes (no dedicated DPR event exists).
 */
export function devicePixelRatioSignal(): ComputedAccessor<number> {
  if (
    getSSRRenderContext() !== null ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return compute(() => 1);
  }
  if (singleton) return singleton;
  const inner = state(window.devicePixelRatio);
  let mql: MediaQueryList = window.matchMedia(`(resolution: ${inner.peek()}dppx)`);
  const onChange = (): void => {
    const next = window.devicePixelRatio;
    inner(next);
    // The previous mql no longer reflects the current DPR; replace it.
    mql.removeEventListener('change', onChange);
    mql = window.matchMedia(`(resolution: ${next}dppx)`);
    mql.addEventListener('change', onChange);
  };
  mql.addEventListener('change', onChange);
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. */
export function _resetDevicePixelRatioSignal(): void {
  singleton = null;
}
