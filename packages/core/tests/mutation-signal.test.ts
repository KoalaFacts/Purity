// @vitest-environment jsdom
// ADR 0040 — mutationSignal tests. MutationObserver is native in jsdom.

import { describe, expect, it } from 'vitest';

import { mutationSignal, watch } from '../src/index.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));
const flushMO = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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

describe('mutationSignal — SSR (ADR 0040)', () => {
  it('returns a constant empty array in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const el = document.createElement('div');
      const sig = mutationSignal(el, { childList: true });
      expect(sig()).toEqual([]);
    } finally {
      popSSRRenderContext();
    }
  });
});

describe('mutationSignal — client (ADR 0040)', () => {
  it('starts as an empty array', () => {
    const el = document.createElement('div');
    const sig = mutationSignal(el, { childList: true });
    expect(sig()).toEqual([]);
  });

  it('records child mutations', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const sig = mutationSignal(el, { childList: true });
    el.appendChild(document.createElement('span'));
    await flushMO();
    expect(sig().length).toBeGreaterThanOrEqual(1);
    expect(sig()[0].type).toBe('childList');
    document.body.removeChild(el);
  });

  it('participates in reactive tracking', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const sig = mutationSignal(el, { childList: true });
    let runs = 0;
    const dispose = watch(sig, () => {
      runs++;
    });
    el.appendChild(document.createElement('span'));
    await flushMO();
    await tick();
    expect(runs).toBeGreaterThanOrEqual(1);
    dispose();
    document.body.removeChild(el);
  });

  it('defaults to { childList: true } when no options are passed', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const sig = mutationSignal(el);
    el.appendChild(document.createElement('span'));
    await flushMO();
    expect(sig().length).toBeGreaterThanOrEqual(1);
    document.body.removeChild(el);
  });
});
