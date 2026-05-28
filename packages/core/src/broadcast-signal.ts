// ---------------------------------------------------------------------------
// broadcastSignal(channel, default, validate) — cross-tab signal over
// BroadcastChannel. ADR 0039.
//
// Server: returns a plain `state(defaultValue)`. The channel is never opened.
// Client: shares one BroadcastChannel + one signal instance per channel name.
//         `.set()` updates the local signal and posts to the channel; incoming
//         messages run through `validate()` and are dropped on mismatch
//         before reaching the signal.
//
// Serialization is structured clone (BroadcastChannel's native format) —
// Date / Map / Set / typed arrays all round-trip without a JSON detour.
// Same-origin only. The `validate` predicate is required because the
// channel crosses a trust boundary: any code on the origin (including a
// compromised chunk) can post to it. See ADR 0039 for the threat model.
// ---------------------------------------------------------------------------

import { state, type StateAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

/**
 * Type-narrowing predicate used to validate incoming `BroadcastChannel`
 * messages before they reach the signal. Receivers should reject any value
 * whose shape they didn't author.
 */
export type BroadcastValidator<T> = (value: unknown) => value is T;

const instances: Map<string, StateAccessor<unknown>> = new Map();
const initialDefaults: Map<string, unknown> = new Map();

/**
 * Cross-tab reactive state over `BroadcastChannel` (ADR 0039).
 *
 * - **Server.** Returns `state(defaultValue)`. The channel is never opened
 *   and `validate` is never invoked.
 * - **Client.** Returns a singleton accessor per `channel` name; subsequent
 *   calls with the same name return the same accessor (and ignore their
 *   `defaultValue` / `validate`). `.set()` updates the local signal and
 *   posts the value to the channel. Incoming messages are passed to
 *   `validate(e.data)` — values that fail the predicate are dropped and
 *   a `console.warn` is emitted so an attack signal is visible in dev.
 * - **Serialization.** Structured clone — `Date`, `Map`, `Set`, typed arrays
 *   all survive.
 * - **Late joiners.** Tabs opened after a broadcast see only the
 *   `defaultValue` until the next set. Pair with `localSignal` when you
 *   need a durable "current value."
 *
 * @example
 * ```ts
 * type Session = { userId: string; expiresAt: number };
 * const isSession = (v: unknown): v is Session | null =>
 *   v === null ||
 *   (typeof v === 'object' && v !== null &&
 *    typeof (v as Session).userId === 'string' &&
 *    typeof (v as Session).expiresAt === 'number');
 *
 * const session = broadcastSignal<Session | null>('auth', null, isSession);
 * session.set(null); // logs out every same-origin tab
 * ```
 */
export function broadcastSignal<T>(
  channel: string,
  defaultValue: T,
  validate: BroadcastValidator<T>,
): StateAccessor<T> {
  if (getSSRRenderContext() !== null) {
    return state(defaultValue);
  }
  if (typeof BroadcastChannel === 'undefined') {
    return state(defaultValue);
  }
  const existing = instances.get(channel);
  if (existing) {
    if (!Object.is(initialDefaults.get(channel), defaultValue)) {
      console.warn(
        `[purity] broadcastSignal('${channel}') called again with a different defaultValue; the first default wins. Extract a shared default to silence this warning.`,
      );
    }
    return existing as StateAccessor<T>;
  }
  initialDefaults.set(channel, defaultValue);

  const inner = state(defaultValue);
  const bc = new BroadcastChannel(channel);
  bc.addEventListener('message', (e: MessageEvent) => {
    if (!validate(e.data)) {
      console.warn(
        `[purity] broadcastSignal('${channel}') dropped incoming message — failed validator`,
      );
      return;
    }
    inner(e.data);
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
  initialDefaults.clear();
}
