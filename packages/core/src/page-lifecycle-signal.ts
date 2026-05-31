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
// Teardown closures captured at wire-time so reset can remove every listener.
let teardown: (() => void) | null = null;

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
    typeof window.addEventListener !== 'function' ||
    typeof document.addEventListener !== 'function'
  ) {
    return compute(() => 'active' as const);
  }
  if (singleton) return singleton;
  const inner = state<PageLifecycleState>(deriveState());
  // `frozen` and `terminated` are terminal — only an explicit `resume` event
  // (or `terminated`-superseding `pagehide`) may leave them. Non-resume
  // events like blur/focus/visibilitychange must not silently roll back.
  const refresh = (): void => {
    try {
      const cur = inner.peek();
      if (cur === 'terminated' || cur === 'frozen') return;
      inner(deriveState());
    } catch (err) {
      console.error('[pageLifecycleSignal] refresh failed', err);
    }
  };
  const onResume = (): void => {
    try {
      // `resume` is the spec path out of `frozen`. Still honor `terminated`.
      if (inner.peek() === 'terminated') return;
      inner(deriveState());
    } catch (err) {
      console.error('[pageLifecycleSignal] resume failed', err);
    }
  };
  const onFreeze = (): void => {
    try {
      if (inner.peek() === 'terminated') return;
      inner('frozen');
    } catch (err) {
      console.error('[pageLifecycleSignal] freeze failed', err);
    }
  };
  const onPagehide = (e: PageTransitionEvent): void => {
    try {
      // `terminated` is final — a later persisted=true pagehide must not
      // demote it back to `frozen`.
      if (inner.peek() === 'terminated') return;
      inner(e.persisted ? 'frozen' : 'terminated');
    } catch (err) {
      console.error('[pageLifecycleSignal] pagehide failed', err);
    }
  };
  // Bind incrementally so a mid-wire throw can roll back every prior listener
  // without leaking handlers on document / window.
  const bound: Array<() => void> = [];
  try {
    document.addEventListener('visibilitychange', refresh);
    bound.push(() => document.removeEventListener('visibilitychange', refresh));
    window.addEventListener('focus', refresh);
    bound.push(() => window.removeEventListener('focus', refresh));
    window.addEventListener('blur', refresh);
    bound.push(() => window.removeEventListener('blur', refresh));
    document.addEventListener('freeze', onFreeze);
    bound.push(() => document.removeEventListener('freeze', onFreeze));
    document.addEventListener('resume', onResume);
    bound.push(() => document.removeEventListener('resume', onResume));
    window.addEventListener('pageshow', refresh);
    bound.push(() => window.removeEventListener('pageshow', refresh));
    window.addEventListener('pagehide', onPagehide as EventListener);
    bound.push(() => window.removeEventListener('pagehide', onPagehide as EventListener));
  } catch (err) {
    for (let i = bound.length - 1; i >= 0; i--) {
      try {
        bound[i]();
      } catch {
        // best-effort rollback; ignore secondary teardown failures.
      }
    }
    throw err;
  }
  teardown = () => {
    for (let i = bound.length - 1; i >= 0; i--) {
      try {
        bound[i]();
      } catch {
        // best-effort teardown.
      }
    }
  };
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes every
 * lifecycle listener so subsequent test runs start from a clean state. */
export function _resetPageLifecycleSignal(): void {
  teardown?.();
  teardown = null;
  singleton = null;
}
