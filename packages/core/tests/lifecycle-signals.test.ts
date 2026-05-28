// @vitest-environment jsdom
// ADR 0039 — page lifecycle signal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bfcacheRestoreSignal,
  pageLifecycleSignal,
  pageVisibilitySignal,
  watch,
} from '../src/index.ts';
import { _resetLifecycleSignals } from '../src/lifecycle-signals.ts';
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

function setFocus(focused: boolean): void {
  Object.defineProperty(document, 'hasFocus', {
    configurable: true,
    value: () => focused,
  });
  window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
}

beforeEach(() => {
  _resetLifecycleSignals();
  setVisibility('visible');
  setFocus(true);
});

afterEach(() => {
  _resetLifecycleSignals();
});

describe('pageVisibilitySignal — SSR (ADR 0039)', () => {
  it('returns `visible` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const v = pageVisibilitySignal();
      expect(v()).toBe('visible');
    } finally {
      popSSRRenderContext();
    }
  });
});

describe('pageVisibilitySignal — client (ADR 0039)', () => {
  it('reflects document.visibilityState on first read', () => {
    const v = pageVisibilitySignal();
    expect(v()).toBe('visible');
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

describe('pageLifecycleSignal (ADR 0039)', () => {
  it('returns `active` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(pageLifecycleSignal()()).toBe('active');
    } finally {
      popSSRRenderContext();
    }
  });

  it('starts in `active` when visible + focused', () => {
    expect(pageLifecycleSignal()()).toBe('active');
  });

  it('transitions to `passive` on blur', () => {
    const s = pageLifecycleSignal();
    setFocus(false);
    expect(s()).toBe('passive');
  });

  it('transitions to `hidden` on visibilitychange → hidden', () => {
    const s = pageLifecycleSignal();
    setVisibility('hidden');
    expect(s()).toBe('hidden');
  });

  it('transitions to `frozen` on freeze event', () => {
    const s = pageLifecycleSignal();
    document.dispatchEvent(new Event('freeze'));
    expect(s()).toBe('frozen');
  });

  it('transitions to `frozen` on pagehide with persisted=true', () => {
    const s = pageLifecycleSignal();
    const event = new Event('pagehide') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
    expect(s()).toBe('frozen');
  });

  it('transitions to `terminated` on pagehide with persisted=false', () => {
    const s = pageLifecycleSignal();
    const event = new Event('pagehide') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    expect(s()).toBe('terminated');
  });

  it('does not clobber terminal `terminated` state on later events', () => {
    const s = pageLifecycleSignal();
    const event = new Event('pagehide') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: false });
    window.dispatchEvent(event);
    expect(s()).toBe('terminated');
    setVisibility('hidden');
    expect(s()).toBe('terminated');
  });

  it('returns the same singleton across calls', () => {
    expect(pageLifecycleSignal()).toBe(pageLifecycleSignal());
  });
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
