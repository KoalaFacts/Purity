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
  const label = String(url);

  let es: EventSource | null = null;
  const onMessage = (e: MessageEvent): void => {
    let parsed: unknown;
    try {
      parsed = parse(e.data as string);
    } catch (err) {
      console.warn(`[purity] eventSourceSignal('${label}') failed to parse:`, err);
      return;
    }
    if (!validate(parsed)) {
      console.warn(
        `[purity] eventSourceSignal('${label}') dropped incoming message — failed validator`,
      );
      return;
    }
    inner(parsed);
  };

  const open = (): void => {
    if (es) return;
    try {
      // Branch the constructor call so CodeQL's web externs (which model
      // EventSource as single-argument) don't flag a `, undefined` trailing
      // argument as superfluous. Both branches are spec-compliant.
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
    es.removeEventListener(eventName, onMessage);
    es.close();
    es = null;
  };

  wireLiveReconnect(reconnect, open, close);
  return compute(() => inner());
}
