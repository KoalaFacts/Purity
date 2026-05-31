// @vitest-environment jsdom
// ADR 0039 — pageLifecycleSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pageLifecycleSignal } from '../src/index.ts';
import { _resetPageLifecycleSignal } from '../src/page-lifecycle-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

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

  // ---------------------------------------------------------------------
  // audit-v2 regressions
  // ---------------------------------------------------------------------

  it('does not clobber terminal `frozen` on later blur/visibility events', () => {
    const s = pageLifecycleSignal();
    document.dispatchEvent(new Event('freeze'));
    expect(s()).toBe('frozen');
    setFocus(false);
    expect(s()).toBe('frozen');
    setVisibility('hidden');
    expect(s()).toBe('frozen');
  });

  it('allows explicit `resume` to leave frozen state', () => {
    const s = pageLifecycleSignal();
    document.dispatchEvent(new Event('freeze'));
    expect(s()).toBe('frozen');
    // Restore document to visible+focused before resume so deriveState picks active.
    setVisibility('visible');
    setFocus(true);
    document.dispatchEvent(new Event('resume'));
    expect(s()).toBe('active');
  });

  it('does not clobber terminal `terminated` even with a later persisted=true pagehide', () => {
    const s = pageLifecycleSignal();
    const term = new Event('pagehide') as Event & { persisted: boolean };
    Object.defineProperty(term, 'persisted', { value: false });
    window.dispatchEvent(term);
    expect(s()).toBe('terminated');
    const back = new Event('pagehide') as Event & { persisted: boolean };
    Object.defineProperty(back, 'persisted', { value: true });
    window.dispatchEvent(back);
    expect(s()).toBe('terminated');
  });

  it('rolls back partially-registered listeners when wiring throws', () => {
    const origAdd = document.addEventListener.bind(document);
    let calls = 0;
    const spyAdd = ((type: string, listener: EventListener, opts?: unknown): void => {
      calls += 1;
      if (type === 'freeze') throw new Error('boom');
      origAdd(type as keyof DocumentEventMap, listener, opts as AddEventListenerOptions);
    }) as typeof document.addEventListener;
    Object.defineProperty(document, 'addEventListener', {
      configurable: true,
      value: spyAdd,
    });
    try {
      expect(() => pageLifecycleSignal()).toThrow(/boom/);
    } finally {
      Object.defineProperty(document, 'addEventListener', {
        configurable: true,
        value: origAdd,
      });
    }
    // After failure no singleton should be cached, and no leftover listeners.
    // Re-wire successfully — fresh signal should behave normally.
    const s = pageLifecycleSignal();
    expect(s()).toBe('active');
    expect(calls).toBeGreaterThan(0);
  });

  it('swallows + logs handler errors so dispatchEvent does not throw', () => {
    pageLifecycleSignal();
    const origError = console.error;
    let logged = 0;
    console.error = () => {
      logged += 1;
    };
    // Force visibilityState getter to throw — refresh() will hit it.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => {
        throw new Error('vbz');
      },
    });
    try {
      expect(() => document.dispatchEvent(new Event('visibilitychange'))).not.toThrow();
      expect(logged).toBeGreaterThanOrEqual(1);
    } finally {
      console.error = origError;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    }
  });
});
