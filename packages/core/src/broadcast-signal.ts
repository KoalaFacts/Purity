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
// Track the underlying BroadcastChannel for each cached instance so that
// `_resetBroadcastSignalRegistry()` can close them — otherwise the listener
// + native channel leak and a subsequent `broadcastSignal(name)` opens a
// second channel for the same name (double-init listener storm).
const channels: Map<string, BroadcastChannel> = new Map();

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
  // Fail fast on bad arguments — otherwise a non-function validator throws
  // inside the message listener on every cross-tab post, which surfaces as
  // an opaque "validator threw" warning storm.
  if (typeof channel !== 'string' || channel.length === 0) {
    throw new TypeError(
      `[purity] broadcastSignal: 'channel' must be a non-empty string (got ${typeof channel}).`,
    );
  }
  if (typeof validate !== 'function') {
    throw new TypeError(
      `[purity] broadcastSignal('${channel}'): 'validate' must be a type-predicate function. See ADR 0039.`,
    );
  }
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
    let ok: boolean;
    try {
      ok = validate(e.data);
    } catch (err) {
      console.warn(
        `[purity] broadcastSignal('${channel}') dropped incoming message — validator threw:`,
        err,
      );
      return;
    }
    if (!ok) {
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

  // Skip the post when the new value is identical to what we already hold
  // (Object.is). The BroadcastChannel spec doesn't echo to the sender, but
  // peer tabs would still forward this no-op back through their own writes,
  // so a self-equal set on the hot path is pure cost — and a stream of
  // them (e.g. mousemove → set) becomes a cross-tab message storm.
  const accessor = ((...args: [T | ((current: T) => T)] | []): T => {
    if (args.length === 0) return inner();
    const value = args[0];
    const prev = inner.peek();
    const next = typeof value === 'function' ? (value as (current: T) => T)(prev) : (value as T);
    inner(next);
    if (!Object.is(prev, next)) post(next);
    return next;
  }) as StateAccessor<T>;
  (accessor as unknown as { get: () => T }).get = () => inner();
  (accessor as unknown as { set: (v: T) => void }).set = (v: T) => {
    const prev = inner.peek();
    inner(v);
    if (!Object.is(prev, v)) post(v);
  };
  (accessor as unknown as { peek: () => T }).peek = () => inner.peek();

  instances.set(channel, accessor as StateAccessor<unknown>);
  channels.set(channel, bc);
  return accessor;
}

/** @internal — test helper. Clears the per-channel instance cache and
 *  closes every opened BroadcastChannel so the message listener doesn't
 *  outlive its owning signal (and so the next `broadcastSignal(name)`
 *  doesn't end up with two live native channels for the same name). */
export function _resetBroadcastSignalRegistry(): void {
  for (const bc of channels.values()) {
    try {
      bc.close();
    } catch {
      // close() on an already-closed channel can throw in some envs —
      // swallow; we're discarding the channel anyway.
    }
  }
  channels.clear();
  instances.clear();
  initialDefaults.clear();
}
