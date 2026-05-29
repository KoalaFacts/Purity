// @vitest-environment jsdom
// ADR 0042 — batterySignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { batterySignal } from '../src/index.ts';
import { _resetBatterySignal } from '../src/battery-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class MockBatteryManager extends EventTarget {
  charging = true;
  chargingTime = 1800;
  dischargingTime = Infinity;
  level = 0.8;
  emit(): void {
    this.dispatchEvent(new Event('levelchange'));
  }
}

let bm: MockBatteryManager | null = null;
let originalGetBattery: unknown;

function installBatteryMock(reject = false): void {
  originalGetBattery = (navigator as unknown as { getBattery?: unknown }).getBattery;
  bm = new MockBatteryManager();
  (navigator as unknown as { getBattery: () => Promise<unknown> }).getBattery = reject
    ? () => Promise.reject(new Error('blocked'))
    : () => Promise.resolve(bm);
}

function uninstallBatteryMock(): void {
  if (originalGetBattery === undefined) {
    delete (navigator as unknown as { getBattery?: unknown }).getBattery;
  } else {
    (navigator as unknown as { getBattery: unknown }).getBattery = originalGetBattery;
  }
  bm = null;
}

beforeEach(() => {
  _resetBatterySignal();
});

afterEach(() => {
  _resetBatterySignal();
  uninstallBatteryMock();
});

describe('batterySignal (ADR 0042)', () => {
  it('returns `null` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(batterySignal()()).toBeNull();
    } finally {
      popSSRRenderContext();
    }
  });

  it('starts at `null` and fills in once getBattery resolves', async () => {
    installBatteryMock();
    const s = batterySignal();
    expect(s()).toBeNull();
    await flush();
    expect(s()).toEqual({
      charging: true,
      chargingTime: 1800,
      dischargingTime: Infinity,
      level: 0.8,
    });
  });

  it('updates on levelchange / chargingchange', async () => {
    installBatteryMock();
    const s = batterySignal();
    await flush();
    bm!.level = 0.5;
    bm!.dispatchEvent(new Event('levelchange'));
    expect(s()!.level).toBe(0.5);
    bm!.charging = false;
    bm!.dispatchEvent(new Event('chargingchange'));
    expect(s()!.charging).toBe(false);
  });

  it('stays `null` when getBattery rejects', async () => {
    installBatteryMock(true);
    const errSpy = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = batterySignal();
    await flush();
    expect(s()).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('stays `null` when getBattery is unavailable', () => {
    const s = batterySignal();
    expect(s()).toBeNull();
  });

  it('returns the same singleton across calls', () => {
    expect(batterySignal()).toBe(batterySignal());
  });

  it('_resetBatterySignal detaches the four BatteryManager listeners', async () => {
    installBatteryMock();
    const orphan = batterySignal();
    await flush();
    expect(orphan()!.level).toBe(0.8);

    _resetBatterySignal();

    // With the leak, the four listeners on `bm` still fire and tick the
    // orphan's inner state. With the fix, they're detached.
    bm!.level = 0.2;
    bm!.dispatchEvent(new Event('levelchange'));
    expect(orphan()!.level).toBe(0.8);
  });

  it('_resetBatterySignal racing against an in-flight getBattery never attaches the listeners', async () => {
    installBatteryMock();
    const orphan = batterySignal(); // begins getBattery().then(...)

    // Reset BEFORE the promise resolves — listener attach must be skipped
    // entirely. Without the abort flag, the .then resolves and adds 4
    // listeners to bm regardless.
    _resetBatterySignal();
    await flush();

    // Mutate + emit. Orphan should not advance — no listener attached.
    bm!.level = 0.1;
    bm!.dispatchEvent(new Event('levelchange'));
    expect(orphan()).toBeNull(); // never even got the initial snapshot
  });
});
