// ---------------------------------------------------------------------------
// Shared MediaQueryList attach/detach branch-selection.
//
// Legacy Safari (< 14) & Edge Legacy expose addListener/removeListener on
// MediaQueryList but not addEventListener('change', …). Both mediaSignal and
// devicePixelRatioSignal need to bind whichever API the runtime advertises
// and never fall through both ways — this is the one piece of their
// listener code that's genuinely identical.
//
// Hardening properties, each earned from a real review finding:
//
// 1. A branch is only chosen when it's COMPLETE (both its add and its
//    remove method exist). A partial polyfill exposing modern
//    `addEventListener` without a matching `removeEventListener` (while a
//    complete legacy pair also exists) must not attach via the broken
//    modern half and then throw when detach is finally called — fall back
//    to the complete legacy pair instead, or to "no API" if neither pair
//    is complete.
//
// 2. Attach and detach are paired, not re-derived independently. A hostile
//    or partial polyfill could expose legacy `addListener` alongside a
//    callable modern `removeEventListener`; a detach that re-checks
//    `typeof mql.removeEventListener` on its own could pick the API that
//    was never actually subscribed to, leaving the real listener attached
//    forever.
//
// 3. The paired detach is written into `binding.detach` SYNCHRONOUSLY
//    before the underlying subscribe call (`addEventListener`/
//    `addListener`), not after attach returns. A hostile target that
//    invokes `onChange` synchronously from inside that very subscribe call
//    (devicePixelRatioSignal defends against exactly this — see its
//    re-entrance guard) would otherwise observe `binding.detach` as still
//    unset, since the caller can't assign attach's return value until
//    attach has returned — by which point the synchronous reentrant call
//    already ran.
//
// 4. Detecting which API is present never throws even if a property is
//    implemented as a getter that throws on read (not just a method that
//    throws when called) — a throw while merely checking `addEventListener`
//    must not prevent falling back to a working legacy pair.
//
// Their surrounding throw/swallow behavior on detach differs on purpose:
// mediaSignal's own detach wrapper always swallows (see media-signal.ts),
// while devicePixelRatioSignal's rebind path needs a throw to trigger a
// rollback (see device-pixel-ratio-signal.ts). That decision stays with
// each caller — the stored detach closure itself never catches.
// ---------------------------------------------------------------------------

type MqlChangeListener = (e: MediaQueryListEvent) => void;

/** Mutable slot `attachMqlChange` writes the paired detach into, synchronously
 * before subscribing — see point 3 above for why this can't just be a
 * return value. */
export interface MqlBinding {
  detach: (() => void) | null;
}

/** `typeof getAdd() === 'function' && typeof getRemove() === 'function'`,
 * but a throw from EITHER property read (a throwing getter, not just a
 * throwing method call) resolves to `false` instead of propagating — see
 * point 4 above. */
function isCompletePair(getAdd: () => unknown, getRemove: () => unknown): boolean {
  try {
    return typeof getAdd() === 'function' && typeof getRemove() === 'function';
  } catch {
    return false;
  }
}

/**
 * Attaches `onChange` via whichever API `mql` exposes — preferring the
 * modern API, but only when both its add and remove methods are callable;
 * otherwise falling back to a complete legacy pair; otherwise neither.
 * Writes the paired detach closure into `binding.detach` (or `null` when no
 * complete API was found) and returns whether attachment happened.
 */
export function attachMqlChange(
  mql: MediaQueryList,
  onChange: MqlChangeListener,
  binding: MqlBinding,
): boolean {
  if (isCompletePair(() => mql.addEventListener, () => mql.removeEventListener)) {
    binding.detach = () => mql.removeEventListener('change', onChange);
    mql.addEventListener('change', onChange);
    return true;
  }
  const legacy = mql as unknown as {
    addListener?: (cb: MqlChangeListener) => void;
    removeListener?: (cb: MqlChangeListener) => void;
  };
  if (isCompletePair(() => legacy.addListener, () => legacy.removeListener)) {
    binding.detach = () => legacy.removeListener!(onChange);
    legacy.addListener!(onChange);
    return true;
  }
  binding.detach = null;
  return false;
}
