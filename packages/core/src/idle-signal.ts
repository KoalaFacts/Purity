// ---------------------------------------------------------------------------
// idleSignal(detector) — reactive Idle Detection API. ADR 0042.
//
// Accepts a user-built IdleDetector (callers handle the permission prompt
// + user-gesture-bound .start() themselves). The signal listens to the
// detector's `change` event and mirrors userState / screenState.
//
// Server: returns `compute(() => DEFAULT_IDLE_STATE)`.
// Client: each call wraps the supplied detector with a fresh signal.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export type IdleSignalState = {
  user: 'active' | 'idle';
  screen: 'locked' | 'unlocked';
};

/**
 * Structural subset of the `IdleDetector` interface we depend on. Defined
 * locally so consumers don't need `@types/wicg-idle-detector`.
 */
export interface IdleDetectorLike extends EventTarget {
  userState?: 'active' | 'idle';
  screenState?: 'locked' | 'unlocked';
}

const DEFAULT_IDLE_STATE: IdleSignalState = { user: 'active', screen: 'unlocked' };

/**
 * Reactive `IdleDetector` state (ADR 0042).
 *
 * Apps build, request permission for, and `.start()` the detector
 * themselves under a user gesture, then hand it in for the signal-shape
 * wrapper.
 *
 * - **Server.** Returns a constant `{ user: 'active', screen: 'unlocked' }`.
 * - **Client.** Mirrors `detector.userState` / `detector.screenState` on
 *   every `change` event.
 *
 * @example
 * ```ts
 * const detector = new IdleDetector();
 * const idle = idleSignal(detector);
 * button.addEventListener('click', async () => {
 *   await IdleDetector.requestPermission();
 *   await detector.start({ threshold: 60_000 });
 * });
 * when(() => idle().user === 'idle', () => html`<screen-saver/>`);
 * ```
 */
export function idleSignal(detector: IdleDetectorLike): ComputedAccessor<IdleSignalState> {
  if (getSSRRenderContext() !== null) {
    return compute(() => DEFAULT_IDLE_STATE);
  }
  const inner = state<IdleSignalState>({
    user: detector.userState ?? 'active',
    screen: detector.screenState ?? 'unlocked',
  });
  detector.addEventListener('change', () => {
    inner({
      user: detector.userState ?? 'active',
      screen: detector.screenState ?? 'unlocked',
    });
  });
  return compute(() => inner());
}
