// ---------------------------------------------------------------------------
// pageLifecycleSignal() — reactive Page Lifecycle state. ADR 0039.
//
// Tracks `active` / `passive` / `hidden` / `frozen` / `terminated` per
// the Page Lifecycle spec. Lazy singleton: first call registers listeners
// for visibilitychange, focus/blur, freeze, resume, pageshow, pagehide.
// SSR / non-browser contexts return a constant `'active'`.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export type PageLifecycleState = 'active' | 'passive' | 'hidden' | 'frozen' | 'terminated';

let singleton: ComputedAccessor<PageLifecycleState> | null = null;

function deriveState(): PageLifecycleState {
  if (typeof document === 'undefined') return 'active';
  if (document.visibilityState === 'hidden') return 'hidden';
  // `document.hasFocus()` distinguishes active (focused) from passive
  // (visible but unfocused) per the Page Lifecycle spec.
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return 'passive';
  return 'active';
}

/**
 * Reactive Page Lifecycle state (ADR 0039).
 *
 * - **Server.** Returns a constant `'active'`.
 * - **Client.** Singleton; registers listeners on `visibilitychange`,
 *   `focus`, `blur`, `freeze`, `resume`, `pageshow`, `pagehide`. `frozen`
 *   and `terminated` are terminal — once set, later non-pagehide events
 *   don't clobber them.
 */
export function pageLifecycleSignal(): ComputedAccessor<PageLifecycleState> {
  if (
    getSSRRenderContext() !== null ||
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function'
  ) {
    return compute(() => 'active' as const);
  }
  if (singleton) return singleton;
  const inner = state<PageLifecycleState>(deriveState());
  const refresh = (): void => {
    if (inner.peek() === 'terminated') return;
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
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton so tests can re-init. */
export function _resetPageLifecycleSignal(): void {
  singleton = null;
}
