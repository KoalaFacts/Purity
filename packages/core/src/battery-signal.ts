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

let singleton: ComputedAccessor<BatteryInfo | null> | null = null;
// Wire-up is async (inside getBattery().then). Track an abort flag so a
// _reset() that fires before the promise resolves prevents the listeners
// from being attached at all — and track the resolved (bm, refresh) so a
// _reset() that fires AFTER resolve can detach the four listeners we add.
let aborted = false;
let boundBattery: EventTarget | null = null;
let boundRefresh: (() => void) | null = null;

function snapshot(bm: BatteryManagerLike): BatteryInfo {
  return {
    charging: bm.charging,
    chargingTime: bm.chargingTime,
    dischargingTime: bm.dischargingTime,
    level: bm.level,
  };
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
  aborted = false;
  const inner = state<BatteryInfo | null>(null);
  const nav = navigator as NavigatorWithBattery;
  if (typeof nav.getBattery === 'function') {
    nav
      .getBattery()
      .then((bm) => {
        if (aborted) return;
        inner(snapshot(bm));
        const refresh = (): void => {
          inner(snapshot(bm));
        };
        bm.addEventListener('chargingchange', refresh);
        bm.addEventListener('levelchange', refresh);
        bm.addEventListener('chargingtimechange', refresh);
        bm.addEventListener('dischargingtimechange', refresh);
        boundBattery = bm;
        boundRefresh = refresh;
      })
      .catch((err) => {
        console.error('[purity] batterySignal getBattery failed:', err);
      });
  }
  singleton = compute(() => inner());
  return singleton;
}

/** @internal — test helper. Detaches the four BatteryManager listeners
 * we attached on resolve, and arms an abort flag so an in-flight
 * getBattery().then attaches nothing. */
export function _resetBatterySignal(): void {
  aborted = true;
  if (boundBattery && boundRefresh) {
    boundBattery.removeEventListener('chargingchange', boundRefresh);
    boundBattery.removeEventListener('levelchange', boundRefresh);
    boundBattery.removeEventListener('chargingtimechange', boundRefresh);
    boundBattery.removeEventListener('dischargingtimechange', boundRefresh);
  }
  boundBattery = null;
  boundRefresh = null;
  singleton = null;
}
