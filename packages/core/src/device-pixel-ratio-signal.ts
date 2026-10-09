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

import { attachMqlChange as attachMqlListener, type MqlBinding } from './mql-listener.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<number> | null = null;
// The binding whose `.detach` is paired with whichever mql/API attach
// actually used — never re-derived from `mql` independently (that would
// risk picking the wrong API on a hostile/partial polyfill exposing a
// mismatched pair). Read lazily (`.detach`, not a captured closure) because
// `attachMqlChange` writes it synchronously before subscribing, which is
// what keeps it valid even if a hostile target invokes `onChange`
// synchronously from inside that very subscribe call — see mql-listener.ts.
let activeBinding: MqlBinding | null = null;

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

  const binding: MqlBinding = { detach: null };

  // `settling` is true for the ENTIRE body of `processChange`, from entry
  // to its `finally` — not just around the attach call — so a reentrant
  // `onChange` during ANY step (matchMedia construction, attach, detach)
  // is deferred, not just dropped: a hostile/legacy target that invokes
  // `onChange` synchronously (during the initial attach, or from inside a
  // rebind's own attach call) can't be acted on safely yet — its own
  // internal registration bookkeeping may not have finished, so detaching
  // "now" could target a listener that isn't registered yet and leak it
  // once registration completes afterward. Instead of dropping that
  // signal entirely (which can leave the accessor stuck on a stale value
  // if the deferred call carried a real, newer DPR), `pendingRecheck`
  // remembers to re-run the check with fresh data once we're safely
  // outside the in-flight call.
  let settling = false;
  let pendingRecheck = false;

  // The DPR value read at the start of the most recent `attemptOnce()`
  // call — `processChange` compares this against a fresh read to tell "a
  // retry would hit the identical failure" from "DPR genuinely moved on
  // to something new while this attempt was failing" (e.g. the failing
  // target's own attach call changed DPR again before throwing).
  let lastAttempted: number | null = null;

  // One rebind attempt. Returns whether it actually committed a new value
  // (vs. a no-op or a failure) — `processChange` uses that, together with
  // `lastAttempted`, to decide whether a deferred recheck is worth retrying.
  const attemptOnce = (): boolean => {
    const next =
      typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : inner.peek();
    lastAttempted = next;
    // No-op rebind guard: spurious `change` fires (or oscillation back to
    // the same DPR mid-handler) shouldn't churn through fresh MQL objects
    // or stack listeners on a cached MQL the runtime returns.
    if (next === inner.peek()) return false;

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
      return false;
    }

    // If the runtime hands back the SAME MediaQueryList we're already on
    // (real browsers cache per query string; jsdom may not), don't restack
    // a listener on it — just commit the state.
    if (nextMql === mql) {
      inner(next);
      return true;
    }

    // Snapshot the previous detach so a partial-failure rollback can
    // restore exactly what was active before we touched anything —
    // `binding.detach` is about to be overwritten by the attach below
    // (synchronously, even if that attach ultimately fails/throws).
    const prevDetach = binding.detach;
    // Attach to the new MQL FIRST. If this throws we still have the old
    // listener live — no observability gap.
    let attached: boolean;
    try {
      attached = attachMqlListener(nextMql, onChange, binding);
    } catch (err) {
      // `binding.detach` may already have been overwritten to point at
      // the new (possibly partially-registered) MQL before the throw
      // (attachMqlChange writes it before subscribing). Restore the old
      // one, but first best-effort-detach whatever got left behind —
      // some hostile/buggy targets genuinely register the listener and
      // THEN throw, and with nothing else tracking that registration,
      // it would otherwise leak forever.
      const maybePartial = binding.detach;
      binding.detach = prevDetach;
      if (maybePartial && maybePartial !== prevDetach) {
        try {
          maybePartial();
        } catch (cleanupErr) {
          // Never silently catch: the attach already failed, and now its
          // best-effort cleanup failed too — log both so a leaked
          // listener at least leaves a diagnostic trail.
          console.error(
            '[purity] devicePixelRatioSignal: cleanup of a partially-registered replacement also failed:',
            cleanupErr,
          );
        }
      }
      console.error(
        '[purity] devicePixelRatioSignal: attach to new MQL failed; keeping previous binding:',
        err,
      );
      return false;
    }
    if (!attached) {
      // No complete subscription API on the new MQL — leave the old
      // binding in place so we still observe future changes.
      binding.detach = prevDetach;
      console.error(
        '[purity] devicePixelRatioSignal: new MQL exposes no listener API; keeping previous binding.',
      );
      return false;
    }
    // Now safely detach the old listener (through the SAME API it was
    // attached with — never re-derived).
    try {
      prevDetach?.();
    } catch (err) {
      // A throw here doesn't tell us whether the old listener actually
      // got removed before the target threw — there's no way to observe
      // that from the caller side. Rolling back (as if detach definitely
      // failed) risks the worse outcome if it actually succeeded: NEITHER
      // MQL ends up subscribed, freezing the signal on a stale value
      // forever. Keeping the new binding risks only a listener leak on
      // the old MQL in the opposite case — strictly less bad, since the
      // signal keeps updating. So: log and keep going rather than revert.
      console.error(
        '[purity] devicePixelRatioSignal: detach from previous MQL failed; keeping new binding:',
        err,
      );
    }
    mql = nextMql;
    inner(next);
    return true;
  };

  const processChange = (): void => {
    settling = true;
    try {
      // Drains deferred rechecks ITERATIVELY (a loop, not recursive
      // self-calls): a target that keeps synchronously firing genuine new
      // DPR changes on every SUCCESSFUL attach would otherwise grow the
      // call stack once per change via a nested `processChange()` call
      // and eventually overflow it, even though each individual change is
      // handled correctly.
      for (;;) {
        const progressed = attemptOnce();
        if (!pendingRecheck) return;
        pendingRecheck = false;
        if (!progressed) {
          // A failed attempt only skips the retry when a retry would hit
          // the IDENTICAL failure — i.e. DPR is still at the value this
          // attempt just tried. If the failing target's own attach call
          // changed DPR again before throwing, `pendingRecheck` represents
          // that genuinely newer value, not a repeat of the same one, and
          // dropping it could leave the signal stuck forever (the old
          // query may never toggle again if DPR keeps moving to OTHER
          // values). Only suppress the retry in the proven-useless case.
          const current =
            typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
              ? window.devicePixelRatio
              : inner.peek();
          if (current === lastAttempted) {
            console.error(
              '[purity] devicePixelRatioSignal: dropping a deferred recheck targeting the same DPR as the failed attempt (would otherwise retry the identical failure indefinitely).',
            );
            return;
          }
          // else: DPR moved on to something new since the failed attempt
          // started — worth trying again, iteratively.
        }
        // else (progressed): loop again, iteratively, to process the
        // deferred change that arrived during this attempt.
      }
    } finally {
      settling = false;
    }
  };

  const onChange = (): void => {
    if (settling) {
      pendingRecheck = true;
      return;
    }
    processChange();
  };

  // Wrap the initial attach with the same `settling` guard as a rebind's
  // attach: a hostile/legacy target invoking `onChange` synchronously from
  // inside THIS call must be deferred too, not just rebind's own attach —
  // see `settling`'s doc comment above and the `pendingRecheck` catch-up
  // right after this block.
  settling = true;
  let attached: boolean;
  try {
    attached = attachMqlListener(mql, onChange, binding);
  } finally {
    settling = false;
  }
  if (!attached) {
    // No listener API available — accessor still works, frozen at initial DPR.
    console.error(
      '[purity] devicePixelRatioSignal: MediaQueryList exposes no listener API; accessor frozen at initial DPR.',
    );
    singleton = compute(() => inner());
    return singleton;
  }
  activeBinding = binding;
  singleton = compute(() => inner());
  // The initial attach above may have been invoked synchronously by a
  // hostile/legacy target BEFORE `singleton`/`activeBinding` existed — see
  // `settling`'s doc comment. Catch up now that we're safely past it.
  if (pendingRecheck) {
    pendingRecheck = false;
    processChange();
  }
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and detaches the
 * listener from the currently-bound media query so tests start clean. */
export function _resetDevicePixelRatioSignal(): void {
  if (activeBinding) {
    try {
      activeBinding.detach?.();
    } catch (err) {
      console.error('[purity] devicePixelRatioSignal: detach during reset failed:', err);
    }
  }
  activeBinding = null;
  singleton = null;
}
