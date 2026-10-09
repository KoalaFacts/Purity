// ---------------------------------------------------------------------------
// Shared MediaQueryList attach/detach branch-selection.
//
// Legacy Safari (< 14) & Edge Legacy expose addListener/removeListener on
// MediaQueryList but not addEventListener('change', …). Both mediaSignal and
// devicePixelRatioSignal need to bind whichever API the runtime advertises
// and never fall through both ways — this is the one piece of their
// listener code that's genuinely identical.
//
// Attach and detach are returned as a PAIR, not re-derived independently:
// a hostile or partial polyfill could expose legacy `addListener` alongside
// a callable modern `removeEventListener` (or vice versa), and a detach that
// re-checks `typeof mql.removeEventListener` on its own could pick the API
// that was never the one actually subscribed to — leaving the real listener
// attached forever. Returning the paired detach closure from attach makes
// that impossible: whichever branch wins at attach time is the only branch
// detach can ever call.
//
// Their surrounding throw/swallow behavior on detach differs on purpose:
// mediaSignal's own detach wrapper always swallows (see media-signal.ts),
// while devicePixelRatioSignal's rebind path needs a throw to trigger a
// rollback (see device-pixel-ratio-signal.ts). That decision stays with
// each caller — the returned detach closure itself never catches.
// ---------------------------------------------------------------------------

type MqlChangeListener = (e: MediaQueryListEvent) => void;

/**
 * Attaches `onChange` via whichever API `mql` exposes and returns the
 * paired detach closure for that same API — or `null` when neither is
 * available (the caller decides the no-subscription fallback).
 */
export function attachMqlChange(
  mql: MediaQueryList,
  onChange: MqlChangeListener,
): (() => void) | null {
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  const legacy = mql as unknown as {
    addListener?: (cb: MqlChangeListener) => void;
    removeListener?: (cb: MqlChangeListener) => void;
  };
  if (typeof legacy.addListener === 'function') {
    legacy.addListener(onChange);
    return () => legacy.removeListener?.(onChange);
  }
  return null;
}
