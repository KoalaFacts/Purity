// @vitest-environment jsdom
// Tests for manageNavTransitions(). ADR 0017.
//
// jsdom doesn't ship startViewTransition or matchMedia for prefers-
// reduced-motion, so we stub them per-test to exercise each branch.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manageNavTransitions, navigate } from '../src/index.ts';

let teardown: (() => void) | null = null;

interface DocStub {
  startViewTransition?: (cb: () => void | Promise<void>) => unknown;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  teardown?.();
  teardown = null;
  // Clean up any stub we left on document.
  delete (document as DocStub).startViewTransition;
  window.history.replaceState(null, '', '/');
});

describe('manageNavTransitions() — capability detection', () => {
  it('is a no-op when document.startViewTransition is missing', () => {
    // No stub installed → returns a no-op teardown.
    teardown = manageNavTransitions();
    // navigate() still works — wrapper was never installed.
    navigate('/no-vt');
    expect(window.location.pathname).toBe('/no-vt');
  });

  it('installs the wrapper when the API is supported', () => {
    let captured: (() => void) | null = null;
    (document as DocStub).startViewTransition = (cb) => {
      captured = cb as () => void;
      return {} as unknown;
    };

    teardown = manageNavTransitions();
    navigate('/with-vt');

    expect(captured).not.toBeNull();
    // The wrapped callback hasn't run yet — URL is still root.
    expect(window.location.pathname).toBe('/');
    captured?.();
    // After the transition's callback fires, the URL is updated.
    expect(window.location.pathname).toBe('/with-vt');
  });
});

describe('manageNavTransitions() — reduced-motion + shouldTransition', () => {
  it('skips the transition when prefers-reduced-motion: reduce', () => {
    let calls = 0;
    (document as DocStub).startViewTransition = (cb) => {
      calls++;
      (cb as () => void)();
      return {} as unknown;
    };
    const originalMM = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;

    teardown = manageNavTransitions();
    navigate('/reduced');
    // navigate ran unwrapped — URL updated, transition didn't fire.
    expect(window.location.pathname).toBe('/reduced');
    expect(calls).toBe(0);

    window.matchMedia = originalMM;
  });

  it('honors a custom shouldTransition predicate (false → no transition)', () => {
    let calls = 0;
    (document as DocStub).startViewTransition = (cb) => {
      calls++;
      (cb as () => void)();
      return {} as unknown;
    };
    teardown = manageNavTransitions({
      shouldTransition: (url) => url.pathname !== '/skip',
    });
    navigate('/skip');
    expect(window.location.pathname).toBe('/skip');
    expect(calls).toBe(0);

    navigate('/wrap');
    expect(window.location.pathname).toBe('/wrap');
    expect(calls).toBe(1);
  });

  it('predicate receives the URL + replace flag', () => {
    const seen: Array<[string, boolean]> = [];
    (document as DocStub).startViewTransition = (cb) => {
      (cb as () => void)();
      return {} as unknown;
    };
    teardown = manageNavTransitions({
      shouldTransition: (url, replace) => {
        seen.push([url.pathname, replace]);
        return false;
      },
    });
    navigate('/a');
    navigate('/b', { replace: true });
    expect(seen).toEqual([
      ['/a', false],
      ['/b', true],
    ]);
  });
});

describe('manageNavTransitions() — lifecycle', () => {
  it('teardown removes the wrapper so subsequent navigate() runs unwrapped', () => {
    let calls = 0;
    (document as DocStub).startViewTransition = (cb) => {
      calls++;
      (cb as () => void)();
      return {} as unknown;
    };
    teardown = manageNavTransitions();
    navigate('/first');
    expect(calls).toBe(1);
    teardown();
    teardown = null;
    navigate('/second');
    expect(calls).toBe(1);
    expect(window.location.pathname).toBe('/second');
  });
});

describe('manageNavTransitions() — listeners + URL signal', () => {
  it('the wrapped callback updates urlSignal + fires onNavigate listeners', async () => {
    const { onNavigate, currentPath } = await import('../src/index.ts');
    (document as DocStub).startViewTransition = (cb) => {
      // Synchronously execute, mirroring the View Transitions API spec.
      (cb as () => void)();
      return {} as unknown;
    };
    const seen: string[] = [];
    const t1 = onNavigate((url) => seen.push(url.pathname));
    teardown = manageNavTransitions();
    navigate('/wrapped');
    expect(seen).toEqual(['/wrapped']);
    expect(currentPath()).toBe('/wrapped');
    t1();
  });
});
