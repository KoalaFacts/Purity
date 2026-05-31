// ---------------------------------------------------------------------------
// batterySignal() — reactive Battery Status API. ADR 0042.
//
// Server: returns `compute(() => null)`.
// Client: lazy singleton. Initial null; once navigator.getBattery() resolves,
//         the signal mirrors the BatteryManager state and listens for
//         charging / level / time change events.
// ---------------------------------------------------------------------------

import { compute, state, type ComputedAccessor } from './signals.ts';
import { getSSRRenderContext } from './ssr-context.ts';

export type BatteryInfo = {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
};

type BatteryManagerLike = EventTarget & BatteryInfo;
type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

const BATTERY_EVENTS = [
  'chargingchange',
  'levelchange',
  'chargingtimechange',
  'dischargingtimechange',
] as const;

let singleton: ComputedAccessor<BatteryInfo | null> | null = null;
// Wire-up is async (inside getBattery().then). Each batterySignal()/reset()
// pair gets a fresh epoch token; an in-flight .then from a previous epoch
// (whose token no longer matches) is ignored, so it can't attach listeners
// to the wrong BatteryManager or stomp the new epoch's state.
let epoch = 0;
let boundBattery: EventTarget | null = null;
let boundRefresh: (() => void) | null = null;

function snapshot(bm: BatteryManagerLike): BatteryInfo | null {
  // Field getters can throw (hardened mocks, DRM-blocked browsers). Isolate
  // the throw so it can't reject the getBattery promise / break the listener
  // dispatch loop — a partial snapshot is meaningless, so return null.
  try {
    return {
      charging: bm.charging,
      chargingTime: bm.chargingTime,
      dischargingTime: bm.dischargingTime,
      level: bm.level,
    };
  } catch (err) {
    console.error('[purity] batterySignal snapshot failed:', err);
    return null;
  }
}

/**
 * Reactive Battery Status API state (ADR 0042).
 *
 * - **Server.** Returns a constant `null`.
 * - **Client.** Lazy singleton; starts at `null`. Once
 *   `navigator.getBattery()` resolves, the signal mirrors the
 *   `BatteryManager` state.
 * - **Unavailable browser.** Permanent `null` (e.g. Firefox).
 */
export function batterySignal(): ComputedAccessor<BatteryInfo | null> {
  if (getSSRRenderContext() !== null || typeof navigator === 'undefined') {
    return compute(() => null as BatteryInfo | null);
  }
  if (singleton) return singleton;
  const myEpoch = ++epoch;
  const inner = state<BatteryInfo | null>(null);
  const nav = navigator as NavigatorWithBattery;
  if (typeof nav.getBattery === 'function') {
    // Wrap synchronously-throwing getBattery() so it can't crash the caller.
    let p: Promise<BatteryManagerLike>;
    try {
      p = nav.getBattery();
    } catch (err) {
      console.error('[purity] batterySignal getBattery failed:', err);
      singleton = compute(() => inner());
      return singleton;
    }
    p.then((bm) => {
      // Epoch mismatch = a _reset() (and possibly a new batterySignal() call)
      // ran between the call site and this .then. Drop the result — don't
      // attach listeners to this bm; don't write to this inner.
      if (myEpoch !== epoch) return;
      const snap = snapshot(bm);
      if (snap !== null) inner(snap);
      const refresh = (): void => {
        // Listener fires after _reset() detached us? Bail. Snapshot throw?
        // Isolate — never let an exception escape into the dispatch loop.
        if (myEpoch !== epoch) return;
        const s = snapshot(bm);
        if (s !== null) inner(s);
      };
      // Half-bound rollback: if addEventListener throws partway through,
      // detach what we already attached so _reset() can't see a half-bound
      // state and so the next epoch starts clean.
      const attached: (typeof BATTERY_EVENTS)[number][] = [];
      try {
        for (let i = 0; i < BATTERY_EVENTS.length; i++) {
          bm.addEventListener(BATTERY_EVENTS[i], refresh);
          attached.push(BATTERY_EVENTS[i]);
        }
      } catch (err) {
        for (let i = 0; i < attached.length; i++) {
          try {
            bm.removeEventListener(attached[i], refresh);
          } catch {
            /* swallow — detach is best-effort */
          }
        }
        console.error('[purity] batterySignal addEventListener failed:', err);
        return;
      }
      boundBattery = bm;
      boundRefresh = refresh;
    }).catch((err) => {
      console.error('[purity] batterySignal getBattery failed:', err);
    });
  }
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Detaches the four BatteryManager listeners
 * we attached on resolve, and bumps the epoch so an in-flight
 * getBattery().then attaches nothing. */
export function _resetBatterySignal(): void {
  epoch++;
  if (boundBattery && boundRefresh) {
    for (let i = 0; i < BATTERY_EVENTS.length; i++) {
      try {
        boundBattery.removeEventListener(BATTERY_EVENTS[i], boundRefresh);
      } catch {
        /* swallow — detach is best-effort */
      }
    }
  }
  boundBattery = null;
  boundRefresh = null;
  singleton = null;
}
