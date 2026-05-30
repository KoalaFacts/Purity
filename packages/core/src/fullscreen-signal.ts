// ---------------------------------------------------------------------------
// fullscreenSignal() — reactive `document.fullscreenElement`. ADR 0041.
//
// Server: returns `compute(() => null)`.
// Client: lazy singleton; initial value from `document.fullscreenElement`
//         (with vendor-prefixed fallbacks), updated on the
//         `fullscreenchange` event (with vendor-prefixed fallbacks).
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

let singleton: ComputedAccessor<Element | null> | null = null;
let onFullscreenChange: (() => void) | null = null;
// Track the exact event names we bound to so reset removes the same set,
// even if the vendor-prefix detection result drifts between calls.
let boundEvents: string[] | null = null;

// Vendor-prefixed event names — order matches the spec → moz → webkit → MS
// progression. We bind every event the document supports rather than
// guessing one: some Safari builds expose both `fullscreenchange` and
// `webkitfullscreenchange` but only fire the latter for legacy code paths.
const FULLSCREEN_EVENTS = [
  'fullscreenchange',
  'mozfullscreenchange',
  'webkitfullscreenchange',
  'MSFullscreenChange',
] as const;

// Read `document.fullscreenElement` with vendor-prefixed fallbacks. Some
// older Safari + Firefox + IE11 builds only expose the prefixed property.
function readFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const d = document as Document & {
    fullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return (
    d.fullscreenElement ??
    d.mozFullScreenElement ??
    d.webkitFullscreenElement ??
    d.msFullscreenElement ??
    null
  );
}

/**
 * Reactive `document.fullscreenElement` (ADR 0041).
 *
 * - **Server.** Returns a constant `null`.
 * - **Client.** Singleton; registers one `fullscreenchange` listener
 *   (plus vendor-prefixed variants where supported).
 */
export function fullscreenSignal(): ComputedAccessor<Element | null> {
  if (
    getSSRRenderContext() !== null ||
    typeof document === 'undefined' ||
    typeof document.addEventListener !== 'function'
  ) {
    return compute(() => null as Element | null);
  }
  if (singleton) return singleton;
  const inner = state<Element | null>(readFullscreenElement());
  // Isolate listener throws — a userland Element subclass with a throwing
  // getter must not crash the event loop or leave the signal stuck.
  const handler = (): void => {
    try {
      inner(readFullscreenElement());
    } catch (err) {
      console.error('[purity] fullscreenSignal: handler threw', err);
    }
  };
  // Publish the handler + singleton refs BEFORE attaching listeners, so a
  // throw from addEventListener cannot leave the module in a half-bound
  // state (some listeners attached, refs lost ⇒ leak on
  // _resetFullscreenSignal).
  onFullscreenChange = handler;
  boundEvents = [];
  singleton = compute(() => inner());
  // Defensive: if a prior partial bind left listeners attached under the
  // same handler ref, remove them first so we never double-bind.
  for (let i = 0; i < FULLSCREEN_EVENTS.length; i++) {
    try {
      document.removeEventListener(FULLSCREEN_EVENTS[i], handler);
    } catch {
      /* noop */
    }
  }
  try {
    for (let i = 0; i < FULLSCREEN_EVENTS.length; i++) {
      const name = FULLSCREEN_EVENTS[i];
      document.addEventListener(name, handler);
      boundEvents.push(name);
    }
  } catch (err) {
    // Roll back so a partial bind doesn't leak listeners or pin a stale
    // singleton that can never receive updates.
    if (boundEvents) {
      for (let i = 0; i < boundEvents.length; i++) {
        try {
          document.removeEventListener(boundEvents[i], handler);
        } catch {
          /* noop */
        }
      }
    }
    onFullscreenChange = null;
    boundEvents = null;
    singleton = null;
    console.error('[purity] fullscreenSignal: failed to register listeners', err);
    return compute(() => readFullscreenElement());
  }
  return singleton;
}

/** @internal — test helper. Clears the cached singleton and removes the
 * document listeners so subsequent test runs start from a clean state. */
export function _resetFullscreenSignal(): void {
  if (onFullscreenChange && typeof document !== 'undefined') {
    const handler = onFullscreenChange;
    // Remove every event we tracked binding to; fall back to the full
    // event list if tracking was lost (e.g. half-bound rollback path).
    const events = boundEvents ?? FULLSCREEN_EVENTS;
    for (let i = 0; i < events.length; i++) {
      try {
        document.removeEventListener(events[i], handler);
      } catch {
        /* noop */
      }
    }
  }
  onFullscreenChange = null;
  boundEvents = null;
  singleton = null;
}
