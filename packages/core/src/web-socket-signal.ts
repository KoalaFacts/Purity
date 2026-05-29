// ---------------------------------------------------------------------------
// webSocketSignal(url, options) — WebSocket lifted into a reactive signal,
// plus send() / readyState() escape hatches. ADR 0047.
//
// Each call opens its own WebSocket. Incoming messages flow through
// `options.parse` (default JSON.parse on string data) then
// `options.validate`. Failing values are dropped with a console.warn.
// Local writes via `.send()` skip validation — they don't cross the
// trust boundary. Calling `.send()` while the socket is not 'open' logs
// a warn and silently drops the message; queueing is explicitly out of
// scope (see ADR 0047 non-features).
//
// Reconnect policy semantics match eventSourceSignal — see
// {@link LiveReconnectPolicy}.
//
// SSR and browsers without WebSocket return an inert accessor returning
// options.initialValue, with no-op send() and readyState() === 'closed'.
// ---------------------------------------------------------------------------

import {
  type LiveReconnectPolicy,
  type LiveValidator,
  wireLiveReconnect,
} from './event-source-signal.ts';
import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export type { LiveReconnectPolicy, LiveValidator } from './event-source-signal.ts';

export type WebSocketReadyState = 'connecting' | 'open' | 'closing' | 'closed';

/** Augmented ComputedAccessor with WebSocket send + readyState escape hatches. */
export type WebSocketSignal<T> = ComputedAccessor<T> & {
  send(data: string | Blob | BufferSource): void;
  readyState(): WebSocketReadyState;
};

export interface WebSocketSignalOptions<T> {
  /** Required default. SSR and unsupported-browser fallbacks return this. */
  initialValue: T;
  /** Required. Incoming messages that fail the predicate are dropped. */
  validate: LiveValidator<T>;
  /** Standard WebSocket subprotocols. */
  protocols?: string | string[];
  /** Pre-validator transform on raw message data. Defaults to `JSON.parse`. */
  parse?: (raw: MessageEvent['data']) => unknown;
  /** Page-lifecycle reconnect policy. Defaults to `'on-visible'`. */
  reconnect?: LiveReconnectPolicy;
}

/**
 * Reactive WebSocket feed (ADR 0047).
 *
 * @example
 * ```ts
 * type Presence = { userId: string; online: boolean };
 * const isPresence = (v: unknown): v is Presence =>
 *   !!v &&
 *   typeof (v as Presence).userId === 'string' &&
 *   typeof (v as Presence).online === 'boolean';
 *
 * const presence = webSocketSignal<Presence | null>('wss://example/presence', {
 *   initialValue: null,
 *   validate: (v): v is Presence | null => v === null || isPresence(v),
 * });
 * presence.send(JSON.stringify({ subscribe: 'team-42' }));
 * ```
 */
export function webSocketSignal<T>(
  url: string | URL,
  options: WebSocketSignalOptions<T>,
): WebSocketSignal<T> {
  if (getSSRRenderContext() !== null || typeof WebSocket === 'undefined') {
    const inert = compute(() => options.initialValue) as WebSocketSignal<T>;
    inert.send = () => {};
    inert.readyState = () => 'closed' as const;
    return inert;
  }

  const inner = state(options.initialValue);
  const stateAccessor = state<WebSocketReadyState>('closed');
  const parse = options.parse ?? ((raw: MessageEvent['data']) => JSON.parse(raw as string));
  const reconnect = options.reconnect ?? 'on-visible';
  const validate = options.validate;
  const label = String(url);

  let ws: WebSocket | null = null;
  const onOpen = (): void => {
    stateAccessor('open');
  };
  const onClose = (): void => {
    stateAccessor('closed');
  };
  const onError = (): void => {
    stateAccessor('closed');
  };
  const onMessage = (e: MessageEvent): void => {
    let parsed: unknown;
    try {
      parsed = parse(e.data);
    } catch (err) {
      console.warn(`[purity] webSocketSignal('${label}') failed to parse:`, err);
      return;
    }
    // Keep validate() inside the try AND narrow within it: the predicate
    // refines `parsed` from `unknown` to `T`, so `inner(value)` stays
    // typed. A separate boolean would discard that narrowing.
    let value: T;
    try {
      if (!validate(parsed)) {
        console.warn(
          `[purity] webSocketSignal('${label}') dropped incoming message — failed validator`,
        );
        return;
      }
      value = parsed;
    } catch (err) {
      console.warn(
        `[purity] webSocketSignal('${label}') dropped incoming message — validator threw:`,
        err,
      );
      return;
    }
    inner(value);
  };

  const open = (): void => {
    if (ws) return;
    stateAccessor('connecting');
    try {
      ws = new WebSocket(url, options.protocols);
    } catch (err) {
      console.warn(`[purity] webSocketSignal('${label}') failed to open:`, err);
      stateAccessor('closed');
      ws = null;
      return;
    }
    ws.addEventListener('open', onOpen);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
    ws.addEventListener('message', onMessage);
  };
  const close = (): void => {
    if (!ws) return;
    const closing = ws;
    ws = null;
    stateAccessor('closing');
    // Detach our four listeners BEFORE close() so a late 'message' arriving
    // after the socket's async close path can't ride back into the shared
    // inner state on the next reconnect cycle. Matches eventSourceSignal.
    closing.removeEventListener('open', onOpen);
    closing.removeEventListener('close', onClose);
    closing.removeEventListener('error', onError);
    closing.removeEventListener('message', onMessage);
    try {
      closing.close();
    } catch (err) {
      console.warn(`[purity] webSocketSignal('${label}') close failed:`, err);
    }
  };

  wireLiveReconnect(reconnect, open, close);

  const accessor = compute(() => inner()) as WebSocketSignal<T>;
  accessor.send = (data: string | Blob | BufferSource): void => {
    if (!ws || stateAccessor.peek() !== 'open') {
      console.warn(`[purity] webSocketSignal('${label}').send() — socket is not open; dropping`);
      return;
    }
    try {
      ws.send(data);
    } catch (err) {
      console.warn(`[purity] webSocketSignal('${label}').send() failed:`, err);
    }
  };
  accessor.readyState = () => stateAccessor();
  return accessor;
}
