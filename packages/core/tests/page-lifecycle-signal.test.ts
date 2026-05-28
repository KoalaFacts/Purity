// @vitest-environment jsdom
// ADR 0039 — pageLifecycleSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pageLifecycleSignal } from '../src/index.ts';
import { _resetPageLifecycleSignal } from '../src/page-lifecycle-signal.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

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
  _resetPageLifecycleSignal();
  setVisibility('visible');
  setFocus(true);
});

afterEach(() => {
  _resetPageLifecycleSignal();
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
