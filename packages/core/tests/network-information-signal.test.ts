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
});
