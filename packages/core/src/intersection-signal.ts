// ---------------------------------------------------------------------------
// intersectionSignal(target, options?) — IntersectionObserver as a signal.
// ADR 0040.
//
// Server: returns `compute(() => false)`. No observer attached.
// Client: instantiates one IntersectionObserver per call, observes `target`,
//         and writes `entry.isIntersecting` into the signal on each
//         observer callback. Initial value is `false`; the first callback
//         (which IntersectionObserver fires on observe()) updates it.
// ---------------------------------------------------------------------------

import { getCurrentContext } from './component.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Reactive `entry.isIntersecting` for an element via `IntersectionObserver`
 * (ADR 0040).
 *
 * - **Server.** Returns `compute(() => false)`. No observer attached.
 * - **Client.** Creates one `IntersectionObserver` per call, observes
 *   `target`, and writes `entry.isIntersecting` into the signal on each
 *   callback.
 *
 * @example
 * ```ts
 * let img!: HTMLImageElement;
 * onMount(() => {
 *   const onScreen = intersectionSignal(img, { rootMargin: '200px' });
 *   watch(onScreen, (visible) => {
 *     if (visible) img.src = realSrc;
 *   });
 * });
 * ```
 */
export function intersectionSignal(
  target: Element,
  options?: IntersectionObserverInit,
): ComputedAccessor<boolean> {
  if (getSSRRenderContext() !== null || typeof IntersectionObserver === 'undefined') {
    return compute(() => false);
  }
  const inner = state(false);
  // target=null/undefined edge: spec'd `observe()` throws TypeError on a
  // non-Element. Without this guard we'd leak the observer (constructed
  // before observe() throws). Returning the constant matches the
  // missing-API/SSR branch and keeps signature stable for callers using
  // `let img!: HTMLImageElement` patterns that mis-init to null.
  if (target == null) return compute(() => false);
  const observer = new IntersectionObserver((entries) => {
    // The last entry in the batch reflects the most recent state for
    // `target` (callback fires once per target per batch).
    const entry = entries[entries.length - 1];
    if (!entry) return;
    // Throw isolation: a downstream watch/compute can throw when we
    // push the new value. Without this, the exception propagates back
    // through the IntersectionObserver dispatch and (a) gets surfaced
    // as a top-level "Uncaught" with no source context, and (b) on
    // some engines tears down the IO microtask, killing future
    // notifications for unrelated observers in the same batch. Match
    // the disposer/onDestroy convention: log and swallow.
    try {
      inner(entry.isIntersecting);
    } catch (err) {
      console.error('[Purity] intersectionSignal callback error:', err);
    }
  }, options);
  // observer.observe() can throw if `target` is a detached/foreign node
  // on some engines, or if (in theory) options are malformed and the
  // engine deferred validation. Without the catch the freshly-built
  // observer leaks — disconnect+rethrow so the caller sees the original
  // error but the OS-side observer is released.
  try {
    observer.observe(target);
  } catch (err) {
    observer.disconnect();
    throw err;
  }
  // Without this, calling intersectionSignal() inside a component left the
  // observer alive until the accessor itself was GC'd — and the accessor's
  // sources retain the observer's closure indefinitely. Auto-disconnect on
  // the surrounding component's unmount, matching how watch() + cycle-14
  // localSignal auto-dispose. Module-scope calls have no ctx and keep the
  // documented "lifetime = page" semantics.
  //
  // Idempotency: a disposer can fire multiple times in pathological
  // teardown ordering (parent + child both holding the same handle, or
  // a manual onDispose re-trigger). `IntersectionObserver.disconnect()`
  // is spec'd as a no-op when already disconnected, but we still guard
  // with a flag to avoid re-entering on engines that throw post-GC.
  const ctx = getCurrentContext();
  if (ctx) {
    let disposed = false;
    (ctx.disposers ??= []).push(() => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
    });
  }
  return compute(() => inner());
}
