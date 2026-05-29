// @vitest-environment jsdom
// ADR 0041 — onlineSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { onlineSignal, watch } from '../src/index.ts';
import { _resetOnlineSignal } from '../src/online-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

beforeEach(() => {
  _resetOnlineSignal();
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

afterEach(() => {
  _resetOnlineSignal();
});

describe('onlineSignal (ADR 0041)', () => {
  it('returns a constant `true` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(onlineSignal()()).toBe(true);
    } finally {
      popSSRRenderContext();
    }
  });

  it('reflects navigator.onLine on first read', () => {
    expect(onlineSignal()()).toBe(true);
  });

  it('flips on online/offline events', async () => {
    const s = onlineSignal();
    const seen: boolean[] = [];
    const dispose = watch(() => seen.push(s()));
    window.dispatchEvent(new Event('offline'));
    await tick();
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(seen).toEqual([true, false, true]);
    dispose();
  });

  it('returns the same singleton across calls', () => {
    expect(onlineSignal()).toBe(onlineSignal());
  });
});
