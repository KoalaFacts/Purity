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
// Captured so reset can detach the listener from the currently-bound mql.
let activeMql: MediaQueryList | null = null;
let activeOnChange: (() => void) | null = null;

// Legacy Safari (< 14) / Edge Legacy expose addListener/removeListener on
// MediaQueryList but not the standard addEventListener('change', …). Bind
// whichever the runtime advertises and return a detach() that does the same.
function attachMqlListener(mql: MediaQueryList, onChange: () => void): boolean {
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return true;
  }
  const legacy = mql as unknown as {
    addListener?: (cb: () => void) => void;
  };
  if (typeof legacy.addListener === 'function') {
    legacy.addListener(onChange);
    return true;
  }
  return false;
}

function detachMqlListener(mql: MediaQueryList, onChange: () => void): void {
  if (typeof mql.removeEventListener === 'function') {
    mql.removeEventListener('change', onChange);
    return;
  }
  const legacy = mql as unknown as {
    removeListener?: (cb: () => void) => void;
  };
  legacy.removeListener?.(onChange);
}

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
  // Snapshot DPR once at install; the initial state and initial query MUST
  // come from the same read so the binding can't drift if DPR mutates
  // between the two reads.
  const initial =
    typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  const inner = state(initial);

  let mql: MediaQueryList;
  try {
    mql = window.matchMedia(`(resolution: ${initial}dppx)`);
  } catch (err) {
    // Hostile / non-conforming engine — keep the accessor working (frozen at
    // the initial DPR) rather than crashing the caller.
    console.error('[purity] devicePixelRatioSignal: matchMedia failed:', err);
    singleton = compute(() => inner());
    return singleton;
  }

  // Re-entrance guard: if the change handler synchronously triggers another
  // change (legacy engines, hostile observers, attach-fires-sync targets),
  // drop the nested call instead of infinitely rebinding.
  let rebinding = false;
  const onChange = (): void => {
    if (rebinding) return;
    rebinding = true;
    try {
      const next =
        typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
          ? window.devicePixelRatio
          : inner.peek();
      // No-op rebind guard: spurious `change` fires (or oscillation back to
      // the same DPR mid-handler) shouldn't churn through fresh MQL objects
      // or stack listeners on a cached MQL the runtime returns.
      if (next === inner.peek()) return;

      let nextMql: MediaQueryList;
      try {
        nextMql = window.matchMedia(`(resolution: ${next}dppx)`);
      } catch (err) {
        // Can't bind a new MQL — keep the existing listener live so we don't
        // lose future updates, and skip the state write so it stays in sync
        // with the still-bound query.
        console.error(
          '[purity] devicePixelRatioSignal: matchMedia rebind failed; keeping previous binding:',
          err,
        );
        return;
      }

      // If the runtime hands back the SAME MediaQueryList we're already on
      // (real browsers cache per query string; jsdom may not), don't restack
      // a listener on it — just commit the state.
      if (nextMql === mql) {
        inner(next);
        return;
      }

      // Snapshot the previous binding so a partial-failure rollback can
      // restore exactly what was active before we touched anything.
      const prev = mql;
      // Attach to the new MQL FIRST. If this throws we still have the old
      // listener live — no observability gap.
      let attached = false;
      try {
        attached = attachMqlListener(nextMql, onChange);
      } catch (err) {
        console.error(
          '[purity] devicePixelRatioSignal: attach to new MQL failed; keeping previous binding:',
          err,
        );
        return;
      }
      if (!attached) {
        // No subscription API on the new MQL — leave the old binding in place
        // so we still observe future changes.
        console.error(
          '[purity] devicePixelRatioSignal: new MQL exposes no listener API; keeping previous binding.',
        );
        return;
      }
      // Now safely detach the old listener. If detach throws, undo the new
      // attach so we don't end up double-bound on a runtime that returns the
      // same MQL across rebinds (cached identity).
      try {
        detachMqlListener(prev, onChange);
      } catch (err) {
        console.error(
          '[purity] devicePixelRatioSignal: detach from previous MQL failed; rolling back:',
          err,
        );
        try {
          detachMqlListener(nextMql, onChange);
        } catch {
          /* best-effort rollback */
        }
        return;
      }
      mql = nextMql;
      activeMql = nextMql;
      inner(next);
    } finally {
      rebinding = false;
    }
  };

  if (!attachMqlListener(mql, onChange)) {
    // No listener API available — accessor still works, frozen at initial DPR.
    console.error(
      '[purity] devicePixelRatioSignal: MediaQueryList exposes no listener API; accessor frozen at initial DPR.',
    );
    singleton = compute(() => inner());
    return singleton;
  }
  activeMql = mql;
  activeOnChange = onChange;
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and detaches the
 * listener from the currently-bound media query so tests start clean. */
export function _resetDevicePixelRatioSignal(): void {
  if (activeMql && activeOnChange) {
    try {
      detachMqlListener(activeMql, activeOnChange);
    } catch (err) {
      console.error('[purity] devicePixelRatioSignal: detach during reset failed:', err);
    }
  }
  activeMql = null;
  activeOnChange = null;
  singleton = null;
}
