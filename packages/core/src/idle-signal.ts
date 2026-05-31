// ---------------------------------------------------------------------------
// idleSignal(detector) — reactive Idle Detection API. ADR 0042.
//
// Accepts a user-built IdleDetector (callers handle the permission prompt
// + user-gesture-bound .start() themselves). The signal listens to the
// detector's `change` event and mirrors userState / screenState.
//
// Server: returns `compute(() => DEFAULT_IDLE_STATE)`.
// Client: each detector is wrapped at most once — repeated calls with the
//         same detector return the cached accessor so two consumers don't
//         attach two `change` listeners.
//
// Lifecycle:
//   - The `change` listener is registered through an AbortController; if
//     called inside a component scope we wire `onDispose` to abort, which
//     drops the listener and prevents any post-dispose `change` event from
//     mutating the signal.
//   - Reads of `detector.userState` / `detector.screenState` and the listener
//     body are isolated in try/catch so a throwing detector can't poison the
//     reactive flush.
//   - When `addEventListener` is unavailable (degraded environment / partial
//     polyfill) we still expose a one-shot snapshot accessor.
// ---------------------------------------------------------------------------

import { onDispose } from './component.ts';
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

// Per-detector cache so two callers handing in the same detector instance
// share the same accessor (and the same single `change` listener) instead
// of double-binding.
const cache: WeakMap<IdleDetectorLike, ComputedAccessor<IdleSignalState>> = new WeakMap();

function readSnapshot(detector: IdleDetectorLike): IdleSignalState {
  // Reads are wrapped because some detector implementations expose userState /
  // screenState as getters that throw before `.start()` has resolved.
  try {
    return {
      user: detector.userState ?? 'active',
      screen: detector.screenState ?? 'unlocked',
    };
  } catch (err) {
    console.error('[purity] idleSignal failed to read detector state:', err);
    return DEFAULT_IDLE_STATE;
  }
}

/**
 * Reactive `IdleDetector` state (ADR 0042).
 *
 * Apps build, request permission for, and `.start()` the detector
 * themselves under a user gesture, then hand it in for the signal-shape
 * wrapper.
 *
 * - **Server.** Returns a constant `{ user: 'active', screen: 'unlocked' }`.
 * - **Client.** Mirrors `detector.userState` / `detector.screenState` on
 *   every `change` event. Repeat calls with the same detector return the
 *   cached accessor — only one `change` listener is ever attached per
 *   detector instance.
 * - **Component-scoped.** If called inside a `component()` render, the
 *   `change` listener auto-detaches on `onDispose` so unmounting drops
 *   the binding cleanly.
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
  const existing = cache.get(detector);
  if (existing) return existing;

  const inner = state<IdleSignalState>(readSnapshot(detector));

  // Use AbortController so dispose is a single signal regardless of how
  // we tear down (manual _evict, component onDispose, or future cancel).
  const controller = typeof AbortController === 'function' ? new AbortController() : null;

  const handler = (): void => {
    if (controller?.signal.aborted) return;
    try {
      inner(readSnapshot(detector));
    } catch (err) {
      console.error('[purity] idleSignal change handler failed:', err);
    }
  };

  if (typeof detector.addEventListener === 'function') {
    try {
      // Pass the abort signal as the listener option so removal is one
      // controller.abort() instead of tracking a removeEventListener pair.
      if (controller) {
        detector.addEventListener('change', handler, { signal: controller.signal });
      } else {
        detector.addEventListener('change', handler);
      }
    } catch (err) {
      console.error('[purity] idleSignal failed to register change listener:', err);
    }
  }

  const accessor = compute(() => inner());
  cache.set(detector, accessor);

  // If we're inside a component render, auto-tear-down on unmount. Calling
  // onDispose outside a scope is a safe no-op.
  onDispose(() => {
    controller?.abort();
    // Fallback for environments that don't honour the `signal` option on
    // addEventListener — explicitly remove the listener too.
    if (typeof detector.removeEventListener === 'function') {
      try {
        detector.removeEventListener('change', handler);
      } catch {
        /* swallow — environment degraded, nothing more we can do */
      }
    }
    cache.delete(detector);
  });

  return accessor;
}

/** @internal — test helper. Evict a single detector from the cache so a
 * subsequent `idleSignal(sameDetector)` call rebuilds (used by the
 * "double-bind across consumers" regression test where the detector
 * lives longer than the consumer scope). */
export function _evictIdleSignal(detector: IdleDetectorLike): void {
  cache.delete(detector);
}
