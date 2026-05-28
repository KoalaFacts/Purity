// @vitest-environment jsdom
// ADR 0039 — pageVisibilitySignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pageVisibilitySignal, watch } from '../src/index.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
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

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  _resetPageVisibilitySignal();
  setVisibility('visible');
});

afterEach(() => {
  _resetPageVisibilitySignal();
});

describe('pageVisibilitySignal — SSR (ADR 0039)', () => {
  it('returns `visible` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(pageVisibilitySignal()()).toBe('visible');
    } finally {
      popSSRRenderContext();
    }
  });
});

describe('pageVisibilitySignal — client (ADR 0039)', () => {
  it('reflects document.visibilityState on first read', () => {
    expect(pageVisibilitySignal()()).toBe('visible');
  });

  it('updates on visibilitychange', () => {
    const v = pageVisibilitySignal();
    setVisibility('hidden');
    expect(v()).toBe('hidden');
    setVisibility('visible');
    expect(v()).toBe('visible');
  });

  it('returns the same singleton across calls', () => {
    expect(pageVisibilitySignal()).toBe(pageVisibilitySignal());
  });

  it('participates in reactive tracking', async () => {
    const v = pageVisibilitySignal();
    const seen: string[] = [];
    const dispose = watch(() => seen.push(v()));
    setVisibility('hidden');
    await tick();
    expect(seen).toEqual(['visible', 'hidden']);
    dispose();
  });
});
