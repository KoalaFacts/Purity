// @vitest-environment jsdom
// ADR 0042 — batterySignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { batterySignal } from '../src/index.ts';
import { _resetBatterySignal } from '../src/battery-signal.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makeSSRContext(): SSRRenderContext {
  return {
    pendingPromises: [],
    resolvedData: [],
    resolvedErrors: [],
    resourceCounter: 0,
    resolvedDataByKey: {},
    resolvedErrorsByKey: {},
    suspenseCounter: 0,
    boundaryStartTimes: new Map(),
  };
}

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
});
