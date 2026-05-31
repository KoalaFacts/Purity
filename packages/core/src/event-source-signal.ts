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
import { getCurrentContext } from './component.ts';
import { pageVisibilitySignal } from './page-visibility-signal.ts';
import { compute, state, watch, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

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

/**
 * Allow-list of URL schemes accepted by eventSourceSignal. Browsers
 * reject non-HTTP(S) schemes at `new EventSource()` time, but a hostile
 * SSR-derived URL string with an attacker-controlled `javascript:`,
 * `data:`, `blob:`, or `file:` scheme would still be reflected into our
 * `console.warn` diagnostics and (under non-conformant runtimes /
 * tests) reach the constructor. Enforce HTTP(S) before construction so
 * the trust boundary lives at the signal — not at the browser.
 *
 * @internal
 */
export function isSafeEventSourceUrl(url: string | URL): boolean {
  if (typeof url !== 'string') {
    const proto = url.protocol;
    return proto === 'http:' || proto === 'https:';
  }
  // Relative (no scheme) is fine — it resolves against document.baseURI
  // which the page already trusts. Match the same RFC-3986 scheme prefix
  // used by redactUrl() for consistency.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
  try {
    const proto = new URL(url).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    // Unparseable absolute-looking string — let the constructor reject it
    // so the surface error matches the platform.
    return false;
  }
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
  // URL instance: always absolute by construction — redact directly.
  if (typeof url !== 'string') {
    return `${url.protocol}//${url.host}${url.pathname}`;
  }
  // For a string input, distinguish absolute from relative without
  // letting a dummy base leak into the label:
  //  - Absolute (has scheme://): parse and redact protocol+host+path.
  //  - Relative (/path, ./path, no scheme): strip ?query and #hash
  //    in-place so a `?access_token=…` is removed but the path stays.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return url;
    }
  }
  // Relative: trim at the first `?` or `#`.
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  const cut = q === -1 ? h : h === -1 ? q : Math.min(q, h);
  return cut === -1 ? url : url.slice(0, cut);
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
  const visible = pageVisibilitySignal();
  const bfcache = bfcacheRestoreSignal();

  if (reconnect === 'on-visible') {
    watch(visible, (v) => {
      if (v === 'visible') open();
      else close();
    });
    if (visible.peek() === 'visible') open();
  } else {
    // 'always'
    open();
  }

  // Both 'on-visible' and 'always' force a clean reconnect on bfcache
  // restore. The underlying connection is paused during freeze; refreshing
  // it on resume avoids stale-state surprises.
  watch(bfcache, () => {
    const shouldBeOpen = reconnect === 'always' || visible.peek() === 'visible';
    if (shouldBeOpen) {
      close();
      open();
    }
  });
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
  if (getSSRRenderContext() !== null || typeof EventSource === 'undefined') {
    return compute(() => options.initialValue);
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
  // Refuse non-HTTP(S) URLs up-front. `javascript:`, `data:`, `blob:`,
  // and `file:` schemes are NOT valid SSE endpoints; reflecting them
  // through `new EventSource(url)` invites runtime-specific surprises
  // (jsdom + custom mocks won't reject), so gate before construction.
  const urlIsSafe = isSafeEventSourceUrl(url);

  let es: EventSource | null = null;
  // `disposed` guards against open() racing a unmount-triggered close():
  // wireLiveReconnect's watch may schedule an open() asynchronously, and
  // we DON'T want it to reopen the connection after the surrounding
  // component has unmounted (or after the explicit disposer ran).
  let disposed = false;
  const onMessage = (e: MessageEvent): void => {
    let parsed: unknown;
    try {
      parsed = parse(e.data as string);
    } catch (err) {
      console.warn(`[purity] eventSourceSignal('${label}') failed to parse:`, err);
      return;
    }
    // Keep validate() inside the try AND narrow within it: the predicate
    // refines `parsed` from `unknown` to `T`, so `inner(value)` stays
    // typed. A separate boolean would discard that narrowing.
    let value: T;
    try {
      if (!validate(parsed)) {
        console.warn(
          `[purity] eventSourceSignal('${label}') dropped incoming message — failed validator`,
        );
        return;
      }
      value = parsed;
    } catch (err) {
      console.warn(
        `[purity] eventSourceSignal('${label}') dropped incoming message — validator threw:`,
        err,
      );
      return;
    }
    inner(value);
  };

  const open = (): void => {
    if (disposed || es) return;
    if (!urlIsSafe) {
      console.warn(
        `[purity] eventSourceSignal('${label}') refused to open — only http(s) schemes are allowed`,
      );
      return;
    }
    try {
      // codeql[js/superfluous-trailing-arguments]
      // CodeQL's web externs model EventSource as single-argument, but the
      // spec accepts an EventSourceInit dict as the second argument. The
      // `withCredentials` option is part of the public ADR 0047 API;
      // deleting the 2-arg call is not an option.
      es = withCredentials ? new EventSource(url, { withCredentials: true }) : new EventSource(url);
    } catch (err) {
      console.warn(`[purity] eventSourceSignal('${label}') failed to open:`, err);
      es = null;
      return;
    }
    es.addEventListener(eventName, onMessage);
  };
  const close = (): void => {
    if (!es) return;
    // Snapshot + null BEFORE removeEventListener/close() so a late
    // synchronous re-entry (close fired during another teardown path)
    // is a fast no-op instead of double-detaching the listener.
    const closing = es;
    es = null;
    closing.removeEventListener(eventName, onMessage);
    closing.close();
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
