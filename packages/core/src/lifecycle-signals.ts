// ---------------------------------------------------------------------------
// Page lifecycle signals — pageVisibilitySignal / pageLifecycleSignal /
// bfcacheRestoreSignal. ADR 0039.
//
// Lazy singletons. Each primitive registers exactly one listener (or one
// per spec event) on first call; subsequent calls return the cached signal.
// Servers and non-browser contexts return frozen constants.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor, type StateAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export type PageLifecycleState = 'active' | 'passive' | 'hidden' | 'frozen' | 'terminated';

let visibilitySingleton: ComputedAccessor<'visible' | 'hidden'> | null = null;
let lifecycleSingleton: ComputedAccessor<PageLifecycleState> | null = null;
let bfcacheSingleton: StateAccessor<number> | null = null;

function isSSR(): boolean {
  return getSSRRenderContext() !== null;
}

function hasDocument(): boolean {
  return typeof document !== 'undefined';
}

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function';
}

/**
 * Reactive `document.visibilityState` (ADR 0039).
 *
 * - **Server.** Returns a constant `'visible'`.
 * - **Client.** Singleton lazy-initialised on first call; registers one
 *   `visibilitychange` listener.
 */
export function pageVisibilitySignal(): ComputedAccessor<'visible' | 'hidden'> {
  if (isSSR() || !hasDocument()) {
    return compute(() => 'visible' as const);
  }
  if (visibilitySingleton) return visibilitySingleton;
  const inner = state(document.visibilityState as 'visible' | 'hidden');
  document.addEventListener('visibilitychange', () => {
    inner(document.visibilityState as 'visible' | 'hidden');
  });
  visibilitySingleton = compute(() => inner());
  return visibilitySingleton;
}

function deriveState(): PageLifecycleState {
  if (!hasDocument()) return 'active';
  if (document.visibilityState === 'hidden') return 'hidden';
  // `document.hasFocus()` distinguishes active (focused) from passive
  // (visible but unfocused) per the Page Lifecycle spec.
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return 'passive';
  return 'active';
}

/**
 * Reactive page lifecycle state (ADR 0039). Tracks `active`, `passive`,
 * `hidden`, `frozen`, and `terminated` per the Page Lifecycle spec.
 *
 * - **Server.** Returns a constant `'active'`.
 * - **Client.** Singleton; registers listeners on `visibilitychange`,
 *   `focus`, `blur`, `freeze`, `resume`, `pageshow`, `pagehide`.
 */
export function pageLifecycleSignal(): ComputedAccessor<PageLifecycleState> {
  if (isSSR() || !hasDocument() || !hasWindow()) {
    return compute(() => 'active' as const);
  }
  if (lifecycleSingleton) return lifecycleSingleton;
  const inner = state<PageLifecycleState>(deriveState());
  const refresh = (): void => {
    // Don't clobber terminal states.
    const cur = inner.peek();
    if (cur === 'terminated') return;
    inner(deriveState());
  };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('blur', refresh);
  document.addEventListener('freeze', () => inner('frozen'));
  document.addEventListener('resume', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', (e: PageTransitionEvent) => {
    inner(e.persisted ? 'frozen' : 'terminated');
  });
  lifecycleSingleton = compute(() => inner());
  return lifecycleSingleton;
}

/**
 * Reactive counter that increments every time the page is restored from
 * the browser's bfcache (ADR 0039). Use as a `watch` dependency to
 * revalidate loaders / refetch resources on back-forward navigation.
 *
 * - **Server.** Returns a `state(0)` that never increments.
 * - **Client.** Singleton; registers one `pageshow` listener and
 *   increments only when `event.persisted === true`.
 *
 * @example
 * ```ts
 * const restored = bfcacheRestoreSignal();
 * watch(restored, () => refetch());
 * ```
 */
export function bfcacheRestoreSignal(): StateAccessor<number> {
  if (isSSR() || !hasWindow()) {
    return state(0);
  }
  if (bfcacheSingleton) return bfcacheSingleton;
  const counter = state(0);
  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if (e.persisted) counter((v) => v + 1);
  });
  bfcacheSingleton = counter;
  return counter;
}

/** @internal — test helper. Clears cached singletons so tests can re-init. */
export function _resetLifecycleSignals(): void {
  visibilitySingleton = null;
  lifecycleSingleton = null;
  bfcacheSingleton = null;
}
