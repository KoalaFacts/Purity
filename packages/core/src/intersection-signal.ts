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
  const observer = new IntersectionObserver((entries) => {
    // The last entry in the batch reflects the most recent state for
    // `target` (callback fires once per target per batch).
    const entry = entries[entries.length - 1];
    if (entry) inner(entry.isIntersecting);
  }, options);
  observer.observe(target);
  // Without this, calling intersectionSignal() inside a component left the
  // observer alive until the accessor itself was GC'd — and the accessor's
  // sources retain the observer's closure indefinitely. Auto-disconnect on
  // the surrounding component's unmount, matching how watch() + cycle-14
  // localSignal auto-dispose. Module-scope calls have no ctx and keep the
  // documented "lifetime = page" semantics.
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(() => observer.disconnect());
  return compute(() => inner());
}
