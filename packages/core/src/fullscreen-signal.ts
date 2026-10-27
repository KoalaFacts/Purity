// ---------------------------------------------------------------------------
// fullscreenSignal() — reactive `document.fullscreenElement`. ADR 0041.
//
// Server: returns `compute(() => null)`.
// Client: lazy singleton; initial value from `document.fullscreenElement`
//         (with vendor-prefixed fallbacks), updated on the
//         `fullscreenchange` event (with vendor-prefixed fallbacks).
// ---------------------------------------------------------------------------

import { bindListeners, isolate, type ListenerSpec } from './listen.ts';
import { createSharedBrowserSignal } from './browser-signal-singleton.ts';
import { compute, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr/state.ts';

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

const fullscreen = createSharedBrowserSignal(readFullscreenElement, (update) => {
  const handler = isolate('fullscreenSignal', () => update(readFullscreenElement()));
  const specs = FULLSCREEN_EVENTS.map((name): ListenerSpec => [document, name, handler]);
  return bindListeners(specs, 'fullscreenSignal');
});

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
  return fullscreen.get();
}

/** @internal — test helper. Clears the cached singleton and removes the
 * document listeners so subsequent test runs start from a clean state. */
export function _resetFullscreenSignal(): void {
  fullscreen.reset();
}
