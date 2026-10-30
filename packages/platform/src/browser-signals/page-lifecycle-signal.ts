// ---------------------------------------------------------------------------
// pageLifecycleSignal() — reactive Page Lifecycle state. ADR 0039.
//
// Tracks `active` / `passive` / `hidden` / `frozen` / `terminated` per
// the Page Lifecycle spec. Lazy singleton: first call registers listeners
// for visibilitychange, focus/blur, freeze, resume, pageshow, pagehide.
// SSR / non-browser contexts return a constant `'active'`.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from '@purityjs/signals';
import { isSSR } from './ssr.ts';

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
    isSSR() ||
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
  const pairs: Array<[EventTarget, string, EventListener]> = [
    [document, 'visibilitychange', refresh],
    [window, 'focus', refresh],
    [window, 'blur', refresh],
    [document, 'freeze', onFreeze],
    [document, 'resume', onResume],
    [window, 'pageshow', refresh],
    [window, 'pagehide', onPagehide as EventListener],
  ];
  const bound: Array<() => void> = [];
  const cleanup = (): void => {
    for (let i = bound.length - 1; i >= 0; i--) {
      try {
        bound[i]();
      } catch {
        // best-effort teardown.
      }
    }
  };
  try {
    for (const [target, type, fn] of pairs) {
      target.addEventListener(type, fn);
      bound.push(() => target.removeEventListener(type, fn));
    }
  } catch (err) {
    cleanup();
    throw err;
  }
  teardown = cleanup;
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
