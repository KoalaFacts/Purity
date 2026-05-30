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
  const inner = state<MutationRecord[]>([]);
  const observer = new MutationObserver((records) => {
    inner(records);
  });
  observer.observe(target, options ?? { childList: true });
  // MutationObserver holds a STRONG ref to its target (callout at top of
  // file), so without this, calling mutationSignal() inside a component
  // pinned the target node alive past component unmount. Auto-disconnect
  // on the surrounding component's unmount; module-scope calls keep the
  // documented "lifetime = page" semantics.
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(() => observer.disconnect());
  return compute(() => inner());
}
