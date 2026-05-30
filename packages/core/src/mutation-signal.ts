// ---------------------------------------------------------------------------
// mutationSignal(target, options?) — MutationObserver as a signal. ADR 0040.
//
// Server: returns `compute(() => [])`. No observer attached.
// Client: instantiates one MutationObserver per call, calls
//         `.observe(target, options)`, and writes the latest batch of
//         records into the signal on each callback. Older batches are
//         dropped — apps that need accumulation reduce inside a compute.
//
// Note: MutationObserver holds a STRONG reference to its target, so the
// accessor keeps the target alive until the accessor itself is GC'd.
// Apps observing short-lived nodes should use the raw API.
// ---------------------------------------------------------------------------

import { getCurrentContext } from './component.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Reactive `MutationRecord[]` for a target via `MutationObserver`
 * (ADR 0040).
 *
 * - **Server.** Returns `compute(() => [])`. No observer attached.
 * - **Client.** Creates one `MutationObserver` per call, observes
 *   `target` with the given `options`. The signal holds the latest
 *   batch of records.
 * - **Default `options`.** When omitted, the observer is started with
 *   `{ childList: true }` (the most common case). Pass an explicit
 *   `options` to observe attributes, character data, or subtrees.
 *
 * @example
 * ```ts
 * let host!: HTMLElement;
 * onMount(() => {
 *   const muts = mutationSignal(host, { childList: true });
 *   watch(muts, (records) => log('children-changed', records.length));
 * });
 * ```
 */
export function mutationSignal(
  target: Node,
  options?: MutationObserverInit,
): ComputedAccessor<MutationRecord[]> {
  if (getSSRRenderContext() !== null || typeof MutationObserver === 'undefined') {
    return compute(() => [] as MutationRecord[]);
  }
  // MutationObserver.observe() throws synchronously if none of childList,
  // attributes, or characterData is true. Validate up front so we surface
  // a useful message at the call site instead of a native TypeError that
  // points back into the observer callback registration.
  const resolved: MutationObserverInit =
    options === undefined ? { childList: true } : options;
  if (!resolved.childList && !resolved.attributes && !resolved.characterData) {
    throw new TypeError(
      '[Purity] mutationSignal(target, options): at least one of childList, attributes, or characterData must be true.',
    );
  }
  const inner = state<MutationRecord[]>([]);
  const observer = new MutationObserver((records) => {
    // Isolate consumer-side throws so a buggy watcher can't kill the
    // observer (subsequent batches would otherwise stop landing here).
    try {
      inner(records);
    } catch (err) {
      console.error('[Purity] mutationSignal observer callback error:', err);
    }
  });
  observer.observe(target, resolved);
  // MutationObserver holds a STRONG ref to its target (callout at top of
  // file), so without this, calling mutationSignal() inside a component
  // pinned the target node alive past component unmount. Auto-disconnect
  // on the surrounding component's unmount; module-scope calls keep the
  // documented "lifetime = page" semantics.
  //
  // Idempotent: parent + nested cleanup paths can both fire the disposer,
  // and disconnect() needs to be a true no-op the second time. We also
  // drain any queued records via takeRecords() — disconnect() drops them
  // silently otherwise, so the last batch of mutations before unmount
  // would never reach the signal.
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    // Drain pending records so the signal sees the final batch before we
    // detach. Guarded by try/catch because takeRecords() shouldn't throw
    // in any spec-compliant impl, but we'd rather not break unmount.
    try {
      const pending = observer.takeRecords();
      if (pending.length > 0) {
        try {
          inner(pending);
        } catch (err) {
          console.error('[Purity] mutationSignal observer callback error:', err);
        }
      }
    } catch {
      // ignore — proceed to disconnect
    }
    observer.disconnect();
  };
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(dispose);
  return compute(() => inner());
}
