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

import { getCurrentContext } from '@purityjs/signals';
import {
  type LiveReconnectPolicy,
  type LiveValidator,
  snapshotLiveUrl,
  makeLiveMessageHandler,
  redactUrl,
  wireLiveReconnect,
} from './event-source-signal.ts';
import { compute, state, type ComputedAccessor } from '@purityjs/signals';
import { isSSR } from './ssr.ts';

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

const WS_EVENTS = ['open', 'close', 'error', 'message'] as const;
// RFC 7230 tchar; reuse the stateless matcher across connections.
const WS_PROTOCOL_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Inert transports can share these methods; active transports need neither
// the methods nor a per-connection factory closure.
const INERT_SEND = (): void => {};
const INERT_READY_STATE = (): WebSocketReadyState => 'closed';

function inertWebSocket<T>(options: WebSocketSignalOptions<T>): WebSocketSignal<T> {
  // Keep only the initial snapshot, not a mutable options object (and its
  // potentially large validator/parse closures), for an inert connection.
  const initialValue = options.initialValue;
  const inert = compute(() => initialValue) as WebSocketSignal<T>;
  inert.send = INERT_SEND;
  inert.readyState = INERT_READY_STATE;
  return inert;
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
  if (isSSR() || typeof WebSocket === 'undefined') {
    return inertWebSocket(options);
  }

  // Use the redacted label for ALL diagnostic console.warn paths so
  // `?access_token=…` and `user:pw@` don't leak into log sinks.
  const label = redactUrl(url);

  // Scheme allow-list: WebSocket only ever opens ws:// or wss://.
  // The browser constructor enforces this, but a pre-check produces a
  // single sourced warn (with a redacted URL) instead of an unredacted
  // DOMException landing in the page's error reporter. It also collapses
  // attacker-controlled URLs like `javascript:…` / `data:…` / a leaked
  // `http:` token from a misconfigured backend into an inert accessor
  // before any side effects fire.
  const safeUrl = snapshotLiveUrl(url, 'ws:', 'wss:');
  if (safeUrl === null) {
    console.warn(
      `[purity] webSocketSignal('${label}') rejected — only ws:// and wss:// URLs are permitted`,
    );
    return inertWebSocket(options);
  }

  // Subprotocol validation: per RFC 6455 §4.1, each subprotocol must be
  // a non-empty token (RFC 7230 §3.2.6 tchar set). Containing CR/LF or
  // other control bytes lets a misconfigured server smuggle headers
  // through the Sec-WebSocket-Protocol echo or trip the browser into a
  // DOMException at construction. Reject pre-construction to a sourced,
  // redacted warn and an inert accessor.
  // Snapshot untrusted option getters and arrays once. A second read after
  // validation could otherwise pass an unvalidated Sec-WebSocket-Protocol
  // value to the browser constructor or to a later reconnect.
  let protocols: string | string[] | undefined;
  try {
    const supplied = options.protocols;
    protocols = Array.isArray(supplied) ? Array.from(supplied) : supplied;
  } catch {
    // Getter/iterator exceptions may contain credentials. Never log them.
    console.warn(
      `[purity] webSocketSignal('${label}') rejected — invalid subprotocol (must be RFC 6455 tokens)`,
    );
    return inertWebSocket(options);
  }
  if (protocols !== undefined) {
    const list = typeof protocols === 'string' ? [protocols] : protocols;
    // findIndex visits sparse holes; duplicate tokens are also invalid per RFC 6455.
    const bad =
      !Array.isArray(list) ||
      list.findIndex(
        (p, i) => typeof p !== 'string' || !WS_PROTOCOL_TOKEN_RE.test(p) || list.indexOf(p) !== i,
      ) !== -1;
    if (bad) {
      console.warn(
        `[purity] webSocketSignal('${label}') rejected — invalid subprotocol (must be RFC 6455 tokens)`,
      );
      return inertWebSocket(options);
    }
  }

  // Rejected connections only need the inert snapshot: allocate reactive
  // nodes and message handlers after both sets of validation have passed.
  const inner = state(options.initialValue);
  const stateAccessor = state<WebSocketReadyState>('closed');
  const parse = options.parse ?? (JSON.parse as (raw: MessageEvent['data']) => unknown);
  const reconnect = options.reconnect ?? 'on-visible';
  const validate = options.validate;

  let ws: WebSocket | null = null;
  const onOpen = (): void => {
    stateAccessor('open');
  };
  const onClose = (): void => {
    stateAccessor('closed');
  };
  const onMessage = makeLiveMessageHandler<T, MessageEvent['data']>(
    'webSocketSignal',
    label,
    parse,
    validate,
    inner,
  );
  // Event names are shared across sockets; only the listener functions are per instance.
  const listeners: EventListener[] = [onOpen, onClose, onClose, onMessage as EventListener];

  const open = (): void => {
    if (ws) return;
    stateAccessor('connecting');
    try {
      ws = new WebSocket(safeUrl, protocols);
    } catch {
      // Native exception messages may include the credential-bearing URL.
      console.warn(`[purity] webSocketSignal('${label}') failed to open`);
      stateAccessor('closed');
      ws = null;
      return;
    }
    try {
      for (let i = 0; i < listeners.length; i++) ws.addEventListener(WS_EVENTS[i], listeners[i]);
    } catch {
      // Listener adapters may echo credential-bearing URLs in thrown errors.
      // Close the partially opened socket without reporting raw exceptions.
      close();
      console.warn(`[purity] webSocketSignal('${label}') failed to add listener`);
    }
  };
  const close = (): void => {
    if (!ws) return;
    const closing = ws;
    ws = null;
    stateAccessor('closing');
    // Detach our four listeners BEFORE close() so a late 'message' arriving
    // after the socket's async close path can't ride back into the shared
    // inner state on the next reconnect cycle. Matches eventSourceSignal.
    let detachFailed = false;
    for (let i = 0; i < listeners.length; i++) {
      try {
        closing.removeEventListener(WS_EVENTS[i], listeners[i]);
      } catch {
        // Continue detaching other handlers and close the transport.
        detachFailed = true;
      }
    }
    if (detachFailed) {
      console.warn(`[purity] webSocketSignal('${label}') listener detach failed`);
    }
    try {
      closing.close();
    } catch {
      console.warn(`[purity] webSocketSignal('${label}') close failed`);
    }
    // Settle a manual close after subscribers observe 'closing'. A
    // bfcache restore closes and opens in the same turn, so this task
    // must not overwrite a replacement socket's connecting/open state.
    queueMicrotask(() => {
      if (ws === null) stateAccessor('closed');
    });
  };

  wireLiveReconnect(reconnect, open, close);

  // Auto-close on the surrounding component's unmount. Without this,
  // every webSocketSignal() call inside a component opened a long-lived
  // socket that survived unmount (wireLiveReconnect's watches handle
  // lifecycle changes but don't close the socket on owner unmount).
  // Module-scope callers keep "lifetime = page" semantics.
  const ctx = getCurrentContext();
  if (ctx) (ctx.disposers ??= []).push(close);

  const accessor = compute(() => inner()) as WebSocketSignal<T>;
  accessor.send = (data: string | Blob | BufferSource): void => {
    if (!ws || stateAccessor.peek() !== 'open') {
      console.warn(`[purity] webSocketSignal('${label}').send() — socket is not open; dropping`);
      return;
    }
    try {
      ws.send(data);
    } catch {
      // Never forward exception details: adapters may echo sent payloads.
      console.warn(`[purity] webSocketSignal('${label}').send() failed`);
    }
  };
  accessor.readyState = () => stateAccessor();
  return accessor;
}
