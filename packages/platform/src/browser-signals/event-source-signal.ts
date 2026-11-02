// ---------------------------------------------------------------------------
// eventSourceSignal(url, options) — Server-Sent Events lifted into a
// reactive signal. ADR 0047.
//
// Each call opens its own EventSource. Incoming events are run through
// `options.parse` (default JSON.parse) then `options.validate` — values
// that fail either are dropped with a console.warn so attack signal is
// visible in dev. The `reconnect` policy controls page-lifecycle behavior:
//
// - 'on-visible' (default) — close on hidden, reopen on visible, force
//   a clean reconnect on each bfcache restore.
// - 'always'                — stay open, force reconnect on bfcache.
// - 'never'                 — open once on construction; never reopen.
//
// SSR and browsers without EventSource return a constant compute of
// options.initialValue. No connection opened, validator never invoked.
// ---------------------------------------------------------------------------

import { bfcacheRestoreSignal } from './bfcache-restore-signal.ts';
import { getCurrentContext } from '@purityjs/signals';
import { pageVisibilitySignal } from './page-visibility-signal.ts';
import { compute, state, watch, type ComputedAccessor } from '@purityjs/signals';
import { isSSR } from './ssr.ts';

/**
 * Type-narrowing predicate used to validate incoming live-data messages
 * before they reach the signal. Shared shape across the live-data family
 * (eventSourceSignal, webSocketSignal). Receivers should reject any value
 * whose shape they didn't author.
 */
export type LiveValidator<T> = (value: unknown) => value is T;

/**
 * Page-lifecycle reconnect policy for live-data signals (ADR 0047).
 *
 * - `'on-visible'` — close while hidden, reopen on visible. Forces a
 *   clean reconnect on each bfcache restore. Battery-friendly default.
 * - `'always'`    — stay open. Forces reconnect on bfcache. For kiosks
 *   / dashboards that need continuous data even when backgrounded.
 * - `'never'`     — open once on construction; caller owns the rest.
 */
export type LiveReconnectPolicy = 'never' | 'on-visible' | 'always';

export interface EventSourceSignalOptions<T> {
  /** Required default. SSR and unsupported-browser fallbacks return this. */
  initialValue: T;
  /** Required. Incoming messages that fail the predicate are dropped. */
  validate: LiveValidator<T>;
  /** Event type to listen for. Defaults to `'message'`. */
  eventName?: string;
  /** Standard EventSource credentials flag. */
  withCredentials?: boolean;
  /** Pre-validator transform on raw event data. Defaults to `JSON.parse`. */
  parse?: (raw: string) => unknown;
  /** Page-lifecycle reconnect policy. Defaults to `'on-visible'`. */
  reconnect?: LiveReconnectPolicy;
}

/** @internal Normalize platform-trimmed URL spellings, but reject embedded controls. */
export function normalizeLiveUrl(url: string): string | null {
  const trimmed = url.trim();
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }
  return trimmed;
}

/** @internal Validate and snapshot the URL that will actually reach the transport. */
export function snapshotLiveUrl(
  url: string | URL,
  firstProtocol: string,
  secondProtocol: string,
): string | null {
  try {
    // Bypass custom URL getters and stringification; proxies fail closed.
    const source = typeof url === 'string' ? url : URL.prototype.toString.call(url);
    const normalized = normalizeLiveUrl(source);
    if (normalized === null) return null;
    // Preserve relative URLs without inventing a browser document base.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return normalized;
    const protocol = new URL(normalized).protocol;
    return protocol === firstProtocol || protocol === secondProtocol ? normalized : null;
  } catch {
    return null;
  }
}

/** Refuse unsupported SSE schemes before constructing an EventSource. */
export function isSafeEventSourceUrl(url: string | URL): boolean {
  return snapshotLiveUrl(url, 'http:', 'https:') !== null;
}

/**
 * Strip secrets from a URL before logging. SSE/WS commonly authenticate
 * via `?access_token=…` (they can't set request headers per spec), and
 * userinfo (`user:pw@`) is similarly sensitive. Every error path of
 * eventSourceSignal / webSocketSignal funnels through `label` into
 * `console.warn`, which then lands in dev consoles, log sinks, and
 * sometimes monitoring backends — leaking auth past the trust boundary
 * the validator predicate is supposed to enforce. Drop query, hash,
 * and userinfo; keep protocol + host + path so the label is still
 * useful for diagnosis.
 *
 * @internal
 */
export function redactUrl(url: string | URL): string {
  try {
    // Native serialization ignores untrusted URL subclass getters and
    // overrides. A proxy without URL internal slots fails closed.
    if (typeof url !== 'string') url = URL.prototype.toString.call(url);
    const normalized = normalizeLiveUrl(url);
    if (normalized === null) return '[invalid URL]';

    // Absolute URLs: parse once and reconstruct from canonical fields, never
    // userinfo, query or hash. Reject opaque schemes before logging.
    if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
      const parsed = new URL(normalized);
      if (!/^(https?|wss?):$/.test(parsed.protocol)) return '[unsupported URL scheme]';
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
    // Validate scheme-relative authorities before cutting query/hash. Otherwise
    // malformed `//user:secret?query@host` can expose credentials in logs.
    if (/^[/\\]{2}/.test(normalized)) {
      const authority = new URL(normalized, 'https://redaction.invalid/');
      if (!authority.host) return '[invalid URL]';
    }
    // Relative URLs: remove query/hash before stripping authority userinfo.
    const q = normalized.indexOf('?');
    const h = normalized.indexOf('#');
    const cut = q === -1 ? h : h === -1 ? q : Math.min(q, h);
    const trimmed = cut === -1 ? normalized : normalized.slice(0, cut);
    // WHATWG treats repeated leading / and \\ as an authority on http(s) pages.
    // Redact userinfo even for mixed and triple-separator relative spellings.
    return trimmed.replace(/^[/\\]{2,}[^/\\]*@/, '//');
  } catch {
    return '[invalid URL]';
  }
}

/**
 * Wire the standard "open while visible, refresh on bfcache" lifecycle.
 * Shared between eventSourceSignal and webSocketSignal so both honour
 * identical reconnect semantics.
 *
 * @internal
 */
export function wireLiveReconnect(
  reconnect: LiveReconnectPolicy,
  open: () => void,
  close: () => void,
): void {
  if (reconnect === 'never') {
    open();
    return;
  }
  // 'always' must not allocate or subscribe to the page visibility signal;
  // only the 'on-visible' policy uses it. Both still reconnect on bfcache.
  const visible = reconnect === 'on-visible' ? pageVisibilitySignal() : null;
  if (visible) {
    watch(visible, (v) => {
      if (v === 'visible') open();
      else close();
    });
    if (visible.peek() === 'visible') open();
  } else {
    open();
  }

  // A bfcache restore refreshes the live transport unless visibility gates it.
  watch(bfcacheRestoreSignal(), () => {
    if (visible === null || visible.peek() === 'visible') {
      close();
      open();
    }
  });
}

/** @internal Shared message parser + validator for live-data signals. */
export function makeLiveMessageHandler<T, R = string>(
  api: string,
  label: string,
  parse: (raw: R) => unknown,
  validate: LiveValidator<T>,
  inner: { set(value: NoInfer<T>): void },
): (e: MessageEvent<R>) => void {
  return (e: MessageEvent<R>): void => {
    let parsed: unknown;
    try {
      parsed = parse(e.data);
    } catch {
      // Parser errors can include the raw message or authentication secrets.
      console.warn(`[purity] ${api}('${label}') failed to parse`);
      return;
    }
    try {
      if (!validate(parsed)) {
        console.warn(`[purity] ${api}('${label}') dropped incoming message — failed validator`);
        return;
      }
    } catch {
      // Validator exceptions can echo the untrusted payload into log sinks.
      console.warn(`[purity] ${api}('${label}') dropped incoming message — validator threw`);
      return;
    }
    // Treat a validated function as a value, never as a state updater.
    inner.set(parsed);
  };
}

/**
 * Reactive Server-Sent Events feed (ADR 0047).
 *
 * @example
 * ```ts
 * type Tick = { symbol: string; price: number };
 * const isTick = (v: unknown): v is Tick =>
 *   !!v &&
 *   typeof (v as Tick).symbol === 'string' &&
 *   typeof (v as Tick).price === 'number';
 *
 * const ticker = eventSourceSignal<Tick | null>('/sse/ticker', {
 *   initialValue: null,
 *   validate: (v): v is Tick | null => v === null || isTick(v),
 * });
 * ```
 */
export function eventSourceSignal<T>(
  url: string | URL,
  options: EventSourceSignalOptions<T>,
): ComputedAccessor<T> {
  if (isSSR() || typeof EventSource === 'undefined') {
    // An inert transport returns the value supplied at creation, not a live
    // read of the caller's mutable options bag (and its other callbacks).
    const initialValue = options.initialValue;
    return compute(() => initialValue);
  }

  // Reconnects must reuse the same validated URL, not a mutable URL subclass.
  const safeUrl = snapshotLiveUrl(url, 'http:', 'https:');
  if (safeUrl === null) {
    // Match the connected path: initialValue is captured at creation time.
    const initialValue = options.initialValue;
    console.warn(
      `[purity] eventSourceSignal('${redactUrl(url)}') refused to open — only http(s) schemes are allowed`,
    );
    return compute(() => initialValue);
  }

  const inner = state(options.initialValue);
  const eventName = options.eventName ?? 'message';
  const parse = options.parse ?? (JSON.parse as (raw: string) => unknown);
  const reconnect = options.reconnect ?? 'on-visible';
  const validate = options.validate;
  const withCredentials = options.withCredentials === true;
  // Use the redacted label for ALL diagnostic console.warn paths so
  // `?access_token=…` and `user:pw@` don't leak into log sinks.
  const label = redactUrl(url);
  let es: EventSource | null = null;
  // `disposed` guards against open() racing a unmount-triggered close():
  // wireLiveReconnect's watch may schedule an open() asynchronously, and
  // we DON'T want it to reopen the connection after the surrounding
  // component has unmounted (or after the explicit disposer ran).
  let disposed = false;
  const onMessage = makeLiveMessageHandler('eventSourceSignal', label, parse, validate, inner);

  const open = (): void => {
    if (disposed || es) return;
    try {
      // codeql[js/superfluous-trailing-arguments]
      // CodeQL's web externs model EventSource as single-argument, but the
      // spec accepts an EventSourceInit dict as the second argument. The
      // `withCredentials` option is part of the public ADR 0047 API;
      // deleting the 2-arg call is not an option.
      es = withCredentials
        ? new EventSource(safeUrl, { withCredentials: true })
        : new EventSource(safeUrl);
    } catch {
      // Constructor exceptions can repeat the credential-bearing endpoint.
      console.warn(`[purity] eventSourceSignal('${label}') failed to open`);
      es = null;
      return;
    }
    try {
      es.addEventListener(eventName, onMessage);
    } catch {
      // An adapter can echo credentials from the endpoint in its exception.
      // Close the partially opened connection without leaking that error.
      close();
      console.warn(`[purity] eventSourceSignal('${label}') failed to add listener`);
    }
  };
  const close = (): void => {
    if (!es) return;
    // Snapshot + null BEFORE removeEventListener/close() so a late
    // synchronous re-entry (close fired during another teardown path)
    // is a fast no-op instead of double-detaching the listener.
    const closing = es;
    es = null;
    try {
      closing.removeEventListener(eventName, onMessage);
    } catch {
      // Still close the connection if a non-native adapter refuses to detach.
      console.warn(`[purity] eventSourceSignal('${label}') listener detach failed`);
    }
    try {
      closing.close();
    } catch {
      // Non-native adapters may throw credential-bearing endpoint details.
      // Never let disposer error reporting echo the raw exception.
      console.warn(`[purity] eventSourceSignal('${label}') close failed`);
    }
  };

  wireLiveReconnect(reconnect, open, close);
  // Auto-close on the surrounding component's unmount. Without this, every
  // eventSourceSignal() call inside a component opened a long-lived TCP
  // connection that survived unmount (the `wireLiveReconnect` watches
  // auto-dispose, but they only flip open/close on lifecycle changes —
  // they don't close the socket on owner unmount). Module-scope callers
  // keep "lifetime = page" semantics. Flip `disposed` first so any
  // open() queued by the lifecycle watches (e.g. a visibility flip racing
  // the unmount) becomes a no-op instead of resurrecting the connection.
  const ctx = getCurrentContext();
  if (ctx)
    (ctx.disposers ??= []).push(() => {
      disposed = true;
      close();
    });
  return compute(() => inner());
}
