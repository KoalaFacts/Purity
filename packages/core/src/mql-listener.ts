// ---------------------------------------------------------------------------
// Shared MediaQueryList attach/detach branch-selection.
//
// Legacy Safari (< 14) & Edge Legacy expose addListener/removeListener on
// MediaQueryList but not addEventListener('change', …). Both mediaSignal and
// devicePixelRatioSignal need to bind whichever API the runtime advertises
// and never fall through both ways — this is the one piece of their
// listener code that's genuinely identical.
//
// Their surrounding throw/swallow behavior on detach differs on purpose:
// mediaSignal's own detach wrapper always swallows (see media-signal.ts),
// while devicePixelRatioSignal's rebind path needs a throw to trigger a
// rollback (see device-pixel-ratio-signal.ts). That decision stays with
// each caller — `detachMqlChange` itself never catches.
// ---------------------------------------------------------------------------

type MqlChangeListener = (e: MediaQueryListEvent) => void;

/** Attaches `onChange` via whichever API `mql` exposes. Returns `false` when
 * neither is available — the caller decides the no-subscription fallback. */
export function attachMqlChange(mql: MediaQueryList, onChange: MqlChangeListener): boolean {
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return true;
  }
  const legacy = mql as unknown as { addListener?: (cb: MqlChangeListener) => void };
  if (typeof legacy.addListener === 'function') {
    legacy.addListener(onChange);
    return true;
  }
  return false;
}

/** Detaches `onChange` via whichever API `mql` exposes. Does not catch —
 * callers decide whether a failed detach should swallow or propagate. */
export function detachMqlChange(mql: MediaQueryList, onChange: MqlChangeListener): void {
  if (typeof mql.removeEventListener === 'function') {
    mql.removeEventListener('change', onChange);
    return;
  }
  const legacy = mql as unknown as { removeListener?: (cb: MqlChangeListener) => void };
  legacy.removeListener?.(onChange);
}
