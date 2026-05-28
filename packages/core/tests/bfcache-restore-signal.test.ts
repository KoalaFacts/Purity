// @vitest-environment jsdom
// ADR 0039 — bfcacheRestoreSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bfcacheRestoreSignal, watch } from '../src/index.ts';
import { _resetBfcacheRestoreSignal } from '../src/bfcache-restore-signal.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));

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

beforeEach(() => {
  _resetBfcacheRestoreSignal();
});

afterEach(() => {
  _resetBfcacheRestoreSignal();
});

describe('bfcacheRestoreSignal (ADR 0039)', () => {
  it('returns 0 in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(bfcacheRestoreSignal()()).toBe(0);
    } finally {
      popSSRRenderContext();
    }
  });

  it('starts at 0 on the client', () => {
    expect(bfcacheRestoreSignal()()).toBe(0);
  });

  it('increments only on pageshow with persisted=true', () => {
    const r = bfcacheRestoreSignal();
    const e1 = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(e1, 'persisted', { value: false });
    window.dispatchEvent(e1);
    expect(r()).toBe(0);

    const e2 = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(e2, 'persisted', { value: true });
    window.dispatchEvent(e2);
    expect(r()).toBe(1);

    const e3 = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(e3, 'persisted', { value: true });
    window.dispatchEvent(e3);
    expect(r()).toBe(2);
  });

  it('fires the registered watch on each restore', async () => {
    const r = bfcacheRestoreSignal();
    let runs = 0;
    const dispose = watch(r, () => {
      runs++;
    });
    const e = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(e, 'persisted', { value: true });
    window.dispatchEvent(e);
    await tick();
    expect(runs).toBe(1);
    dispose();
  });

  it('returns the same singleton across calls', () => {
    expect(bfcacheRestoreSignal()).toBe(bfcacheRestoreSignal());
  });
});
