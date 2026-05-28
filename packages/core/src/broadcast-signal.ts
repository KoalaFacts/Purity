// ---------------------------------------------------------------------------
// broadcastSignal(channel, default) — cross-tab signal over BroadcastChannel.
// ADR 0039.
//
// Server: returns a plain `state(defaultValue)`. The channel is never opened.
// Client: shares one BroadcastChannel + one signal instance per channel name.
//         `.set()` updates the local signal and posts to the channel; incoming
//         messages update the signal without re-posting.
//
// Serialization is structured clone (BroadcastChannel's native format) —
// Date / Map / Set / typed arrays all round-trip without a JSON detour.
// Same-origin only.
// ---------------------------------------------------------------------------

import { state, type StateAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

const instances: Map<string, StateAccessor<unknown>> = new Map();

/**
 * Cross-tab reactive state over `BroadcastChannel` (ADR 0039).
 *
 * - **Server.** Returns `state(defaultValue)`. The channel is never opened.
 * - **Client.** Returns a singleton accessor per `channel` name; subsequent
 *   calls with the same name return the same accessor (and ignore their
 *   `defaultValue`). `.set()` updates the local signal and posts the value
 *   to the channel. Incoming messages update the signal without re-posting.
 * - **Serialization.** Structured clone — `Date`, `Map`, `Set`, typed arrays
 *   all survive.
 * - **Late joiners.** Tabs opened after a broadcast see only the
 *   `defaultValue` until the next set. Pair with `localSignal` when you
 *   need a durable "current value."
 *
 * @example
 * ```ts
 * const session = broadcastSignal<Session | null>('auth', null);
 * session.set(null); // logs out every same-origin tab
 * ```
 */
export function broadcastSignal<T>(channel: string, defaultValue: T): StateAccessor<T> {
  if (getSSRRenderContext() !== null) {
    return state(defaultValue);
  }
  if (typeof BroadcastChannel === 'undefined') {
    return state(defaultValue);
  }
  const existing = instances.get(channel);
  if (existing) return existing as StateAccessor<T>;

  const inner = state(defaultValue);
  const bc = new BroadcastChannel(channel);
  bc.addEventListener('message', (e: MessageEvent) => {
    inner(e.data as T);
  });

  const post = (value: T): void => {
    try {
      bc.postMessage(value);
    } catch (err) {
      console.error('[purity] broadcastSignal postMessage failed:', err);
    }
  };

  const accessor = ((...args: [T | ((current: T) => T)] | []): T => {
    if (args.length === 0) return inner();
    const value = args[0];
    const next =
      typeof value === 'function' ? (value as (current: T) => T)(inner.peek()) : (value as T);
    inner(next);
    post(next);
    return next;
  }) as StateAccessor<T>;
  (accessor as unknown as { get: () => T }).get = () => inner();
  (accessor as unknown as { set: (v: T) => void }).set = (v: T) => {
    inner(v);
    post(v);
  };
  (accessor as unknown as { peek: () => T }).peek = () => inner.peek();

  instances.set(channel, accessor as StateAccessor<unknown>);
  return accessor;
}

/** @internal — test helper. Clears the per-channel instance cache. */
export function _resetBroadcastSignalRegistry(): void {
  instances.clear();
}
