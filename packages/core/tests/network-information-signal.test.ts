// @vitest-environment jsdom
// ADR 0042 — networkInformationSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { networkInformationSignal } from '../src/index.ts';
import { _resetNetworkInformationSignal } from '../src/network-information-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

class MockConnection extends EventTarget {
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g' = '4g';
  saveData = false;
  downlink = 10;
  rtt = 50;
  type = 'wifi';
  emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

let conn: MockConnection | null = null;

function installConnectionMock(): void {
  conn = new MockConnection();
  Object.defineProperty(navigator, 'connection', { configurable: true, value: conn });
}

function uninstallConnectionMock(): void {
  delete (navigator as unknown as { connection?: unknown }).connection;
  conn = null;
}

beforeEach(() => {
  _resetNetworkInformationSignal();
});

afterEach(() => {
  _resetNetworkInformationSignal();
  uninstallConnectionMock();
});

describe('networkInformationSignal (ADR 0042)', () => {
  it('returns the default constant in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const v = networkInformationSignal()();
      expect(v.effectiveType).toBe('4g');
      expect(v.saveData).toBe(false);
    } finally {
      popSSRRenderContext();
    }
  });

  it('mirrors navigator.connection fields on first read', () => {
    installConnectionMock();
    const s = networkInformationSignal();
    expect(s()).toEqual({
      effectiveType: '4g',
      saveData: false,
      downlink: 10,
      rtt: 50,
      type: 'wifi',
    });
  });

  it('updates on change event', () => {
    installConnectionMock();
    const s = networkInformationSignal();
    conn!.effectiveType = 'slow-2g';
    conn!.saveData = true;
    conn!.emit();
    expect(s().effectiveType).toBe('slow-2g');
    expect(s().saveData).toBe(true);
  });

  it('returns the default constant permanently when navigator.connection is missing', () => {
    const s = networkInformationSignal();
    expect(s().effectiveType).toBe('4g');
  });

  it('returns the same singleton across calls', () => {
    installConnectionMock();
    expect(networkInformationSignal()).toBe(networkInformationSignal());
  });

  it('narrows an out-of-spec effectiveType back to the default', () => {
    installConnectionMock();
    // Simulate a future browser returning '5g' (not in the spec union).
    (conn as unknown as { effectiveType: string }).effectiveType = '5g';
    const s = networkInformationSignal();
    expect(s().effectiveType).toBe('4g');
  });

  it('_resetNetworkInformationSignal detaches the change listener', () => {
    installConnectionMock();
    // Capture the orphaned signal from the first call; it must NOT keep
    // ticking after reset (the leak would update its inner state on emit).
    const firstSignal = networkInformationSignal();
    expect(firstSignal().effectiveType).toBe('4g');

    _resetNetworkInformationSignal();

    // Mutate + emit. With the leak, the orphaned listener fires and the
    // old signal's value advances. With the fix, the listener is detached
    // and the orphan stays frozen at its last value.
    (conn as unknown as { effectiveType: string }).effectiveType = 'slow-2g';
    conn!.emit();
    expect(firstSignal().effectiveType).toBe('4g');
  });

  it('isolates throwing field getters in snapshot, falling back to defaults', () => {
    // A hostile / buggy `navigator.connection` whose `downlink` getter
    // throws. The signal must NOT crash; the field falls back to default.
    const throwing = new MockConnection();
    Object.defineProperty(throwing, 'downlink', {
      configurable: true,
      get(): number {
        throw new Error('boom');
      },
    });
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: throwing,
    });

    // Pre-fix: the throwing getter propagates out of snapshot() and crashes
    // networkInformationSignal(). Post-fix: snapshot() catches per-field
    // and falls back to the DEFAULT value (10).
    const s = networkInformationSignal();
    const v = s();
    expect(v.downlink).toBe(10); // default
    expect(v.effectiveType).toBe('4g'); // unaffected siblings still work
    expect(v.type).toBe('wifi');
  });

  it('isolates a throwing navigator.connection getter (returns default signal)', () => {
    // Some browsers / proxies define `navigator.connection` as a throwing
    // getter. The signal must degrade gracefully to the default constant
    // instead of bubbling the throw to the caller.
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      get(): never {
        throw new Error('connection getter blew up');
      },
    });
    // Pre-fix: throws on this call. Post-fix: returns the SSR-default.
    const s = networkInformationSignal();
    expect(s().effectiveType).toBe('4g');
    expect(s().type).toBe('unknown');
    // Cleanup the throwing accessor so afterEach delete works.
    delete (navigator as unknown as { connection?: unknown }).connection;
  });

  it('survives a throwing field getter during a change event', () => {
    installConnectionMock();
    const s = networkInformationSignal();
    expect(s().effectiveType).toBe('4g');

    // After the signal is wired, swap `effectiveType` for a throwing
    // getter. The next `change` emit triggers snapshot() during the
    // listener — per-field try/catch keeps the rest of the snapshot
    // intact and falls back to default for the throwing field.
    Object.defineProperty(conn!, 'effectiveType', {
      configurable: true,
      get(): never {
        throw new Error('effectiveType blew up');
      },
    });
    conn!.saveData = true;
    conn!.emit();
    // After the emit, effectiveType degrades to default, but saveData
    // (which did NOT throw) still propagates the new value.
    expect(s().effectiveType).toBe('4g'); // default — getter threw
    expect(s().saveData).toBe(true); // sibling field updated
  });
});
