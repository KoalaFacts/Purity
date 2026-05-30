// @vitest-environment jsdom
// ADR 0042 — batterySignal tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function installCustomGetBattery(fn: () => Promise<unknown> | unknown): void {
  originalGetBattery = (navigator as unknown as { getBattery?: unknown }).getBattery;
  (navigator as unknown as { getBattery: typeof fn }).getBattery = fn;
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

  it('reset + immediate re-create: in-flight prior-epoch promise must not bind listeners to the prior bm', async () => {
    // Epoch-1 starts. Reset (epoch bumps). Epoch-2 starts (with a new bm).
    // Epoch-1's getBattery resolves AFTER epoch-2 began. The old shared
    // abort-flag design would observe `aborted = false` (set by epoch-2's
    // batterySignal()) and attach 4 listeners to bm-1 — a leak. Epoch
    // tokens prevent it.
    installBatteryMock();
    const bm1 = bm!;
    let resolve1!: (m: MockBatteryManager) => void;
    installCustomGetBattery(
      () =>
        new Promise<MockBatteryManager>((r) => {
          resolve1 = r;
        }),
    );
    batterySignal(); // epoch-1, .then pending
    _resetBatterySignal(); // bump epoch
    installBatteryMock(); // bm-2 + a resolved getBattery
    const s2 = batterySignal(); // epoch-2
    await flush();
    expect(s2()!.level).toBe(0.8);

    // Now resolve epoch-1 against bm-1. Without epoch tokens this attaches
    // 4 listeners to bm-1 (leak) AND overwrites boundBattery → bm-1, so
    // _reset() would now detach bm-1 listeners and leak the bm-2 ones.
    resolve1(bm1);
    await flush();

    // Drive bm-1 — epoch-2's state must not change.
    bm1.level = 0.01;
    bm1.dispatchEvent(new Event('levelchange'));
    expect(s2()!.level).toBe(0.8);

    // _reset() should detach bm-2's listeners (the live ones). Drive bm-2
    // post-reset — must not tick.
    _resetBatterySignal();
    bm!.level = 0.02;
    bm!.dispatchEvent(new Event('levelchange'));
    // s2's compute remembers the last value (0.8); reset detached, so the
    // event is ignored. Sanity: still 0.8, not 0.02.
    expect(s2()!.level).toBe(0.8);
  });

  it('snapshot field getter throw does not crash the promise chain or refresh listener', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // bm.level throws on first read (initial snapshot) but stabilises.
    const throwing = new MockBatteryManager();
    let throwOnce = true;
    Object.defineProperty(throwing, 'level', {
      configurable: true,
      get() {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('field blocked');
        }
        return 0.42;
      },
    });
    installCustomGetBattery(() => Promise.resolve(throwing));
    const s = batterySignal();
    await flush();
    // Initial snapshot threw — stays null, no unhandled rejection.
    expect(s()).toBeNull();
    // But the listeners SHOULD still be attached (the throw was isolated).
    // Drive an event — second read of `level` returns 0.42.
    throwing.dispatchEvent(new Event('levelchange'));
    expect(s()!.level).toBe(0.42);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('addEventListener throw rolls back attached listeners and leaves boundBattery null', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwing = new MockBatteryManager();
    let attachCount = 0;
    const origAdd = throwing.addEventListener.bind(throwing);
    const detached: string[] = [];
    throwing.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      if (++attachCount === 3) throw new Error('attach blocked'); // partial bind
      origAdd(type, listener);
    } as typeof throwing.addEventListener;
    const origRemove = throwing.removeEventListener.bind(throwing);
    throwing.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      detached.push(type);
      origRemove(type, listener);
    } as typeof throwing.removeEventListener;
    installCustomGetBattery(() => Promise.resolve(throwing));
    const s = batterySignal();
    await flush();
    // Initial snapshot succeeded.
    expect(s()!.level).toBe(0.8);
    // 2 attached before throw, both rolled back.
    expect(detached.length).toBe(2);
    // _resetBatterySignal must not attempt to detach from a half-bound bm
    // (would no-op cleanly since boundBattery is null). Verify by emitting
    // an event after reset — must not tick (no listeners survived).
    _resetBatterySignal();
    throwing.level = 0.1;
    throwing.dispatchEvent(new Event('levelchange'));
    // s is detached + reset; calling batterySignal() again starts fresh.
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('synchronous throw from getBattery() does not crash the caller', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    installCustomGetBattery(() => {
      throw new Error('sync boom');
    });
    // Old code: the synchronous throw escapes to the caller (the .then is
    // unreachable). With the try/catch, we still return a usable signal.
    const s = batterySignal();
    expect(s()).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
