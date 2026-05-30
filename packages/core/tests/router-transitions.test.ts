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

describe('manageNavTransitions() — async-aware (ADR 0038)', () => {
  it('awaits awaitNavigation inside the view-transition callback', async () => {
    let resolveGate: (() => void) | undefined;
    let captured: (() => Promise<void>) | null = null;
    (document as DocStub).startViewTransition = (cb) => {
      captured = cb as () => Promise<void>;
      return {} as unknown;
    };
    teardown = manageNavTransitions({
      awaitNavigation: () => new Promise<void>((r) => (resolveGate = r)),
    });
    navigate('/async');
    // Trigger the captured callback — kicks off the async wait.
    const finished = captured!();
    expect(window.location.pathname).toBe('/async'); // update is synchronous

    let settled = false;
    finished.then(() => {
      settled = true;
    });
    await Promise.resolve();
    // The wrapper is still awaiting our gate.
    expect(settled).toBe(false);

    resolveGate!();
    await finished;
    expect(settled).toBe(true);
  });

  it('passes url + replace flag to awaitNavigation', async () => {
    const seen: Array<[string, boolean]> = [];
    let captured: (() => Promise<void>) | null = null;
    (document as DocStub).startViewTransition = (cb) => {
      captured = cb as () => Promise<void>;
      return {} as unknown;
    };
    teardown = manageNavTransitions({
      awaitNavigation: (url, replace) => {
        seen.push([url.pathname, replace]);
        return undefined;
      },
    });
    navigate('/a');
    await captured!();
    navigate('/b', { replace: true });
    await captured!();
    expect(seen).toEqual([
      ['/a', false],
      ['/b', true],
    ]);
  });

  it('returning a non-Promise value is fine — wrapper resolves immediately', async () => {
    let captured: (() => Promise<void>) | null = null;
    (document as DocStub).startViewTransition = (cb) => {
      captured = cb as () => Promise<void>;
      return {} as unknown;
    };
    teardown = manageNavTransitions({
      awaitNavigation: () => 42, // sync return — `await 42` is just 42
    });
    navigate('/sync');
    await captured!();
    expect(window.location.pathname).toBe('/sync');
  });

  it('a rejecting awaitNavigation lets the URL update land before the rejection', async () => {
    let captured: (() => Promise<void>) | null = null;
    (document as DocStub).startViewTransition = (cb) => {
      captured = cb as () => Promise<void>;
      return {} as unknown;
    };
    teardown = manageNavTransitions({
      awaitNavigation: () => Promise.reject(new Error('loader failed')),
    });
    navigate('/failed');
    // Inside the wrapper, `update()` runs synchronously before the
    // `await awaitNavigation(...)`. So by the time the returned promise
    // rejects, the URL change has already happened.
    const settle = captured!();
    expect(window.location.pathname).toBe('/failed');
    await expect(settle).rejects.toThrow('loader failed');
    expect(window.location.pathname).toBe('/failed');
  });

  it('shouldTransition: false still skips the wrapper even when awaitNavigation is set', () => {
    let calls = 0;
    (document as DocStub).startViewTransition = (cb) => {
      calls++;
      void (cb as () => void)();
      return {} as unknown;
    };
    teardown = manageNavTransitions({
      shouldTransition: () => false,
      awaitNavigation: () => Promise.resolve(),
    });
    navigate('/skip');
    // shouldTransition short-circuits before reaching startViewTransition.
    expect(calls).toBe(0);
    expect(window.location.pathname).toBe('/skip');
  });

  it('omitting awaitNavigation keeps the sync callback shape (no async overhead)', () => {
    let lastCb: unknown;
    (document as DocStub).startViewTransition = (cb) => {
      lastCb = cb;
      (cb as () => void)();
      return {} as unknown;
    };
    teardown = manageNavTransitions();
    navigate('/plain');
    // The wrapper passed a sync callback when no awaitNavigation is set.
    // We can't check the function's literal shape, but its execution is
    // synchronous — its return is undefined, not a Promise.
    expect(typeof lastCb).toBe('function');
    expect((lastCb as () => unknown)()).toBeUndefined();
  });
});

describe('manageNavTransitions() — audit-v2 regressions', () => {
  // Finding: synchronous `update()` runs inside the View Transition
  // callback; if it throws — e.g. `history.pushState` rejected
  // (SecurityError in sandboxed iframes, exceeded quota) — the throw
  // escapes the transition callback. Result: browser aborts the
  // transition AND the throw bubbles back to the navigate() caller, on
  // top of a partial URL state. `safeUpdate` wraps update() in
  // try/catch + console.error so the transition unwinds cleanly.
  it('isolates a throwing update() inside the view-transition callback', () => {
    const errors: unknown[] = [];
    const origError = console.error;
    const origPushState = window.history.pushState.bind(window.history);
    let pushCount = 0;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    // Make pushState throw on the FIRST call inside the transition
    // callback. The wrapper must catch it; without safeUpdate the throw
    // would propagate out and abort startViewTransition.
    window.history.pushState = ((..._args: unknown[]) => {
      pushCount++;
      throw new Error('pushState blocked');
    }) as typeof window.history.pushState;
    try {
      (document as DocStub).startViewTransition = (cb) => {
        // Mirror the spec: synchronous callback. The callback CAN throw
        // — without safeUpdate, the throw escapes here and the caller
        // (navigate()) sees it.
        (cb as () => void)();
        return {} as unknown;
      };
      teardown = manageNavTransitions();
      // navigate() must NOT throw — safeUpdate swallows the pushState
      // failure and lets the transition unwind cleanly.
      expect(() => navigate('/safe-update')).not.toThrow();
      expect(pushCount).toBe(1);
      // The throw was logged, not silently dropped.
      expect(
        errors.some(
          (args) =>
            typeof args[0] === 'string' &&
            (args[0] as string).includes('navigate update threw inside view transition'),
        ),
      ).toBe(true);
    } finally {
      window.history.pushState = origPushState;
      console.error = origError;
    }
  });

  // Finding: a rejecting `awaitNavigation` propagates via the View
  // Transition's `updateCallbackDone` promise. Nothing observes it →
  // "Uncaught (in promise)" in test runners / Sentry. Wrapper now
  // attaches a `.catch` that logs via console.error.
  it('observes updateCallbackDone rejections and logs them via console.error', async () => {
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      let captured: (() => Promise<void>) | null = null;
      let updateCallbackDone: Promise<unknown> | undefined;
      (document as DocStub).startViewTransition = (cb) => {
        captured = cb as () => Promise<void>;
        // The browser awaits `cb()` and exposes the resulting promise as
        // `.updateCallbackDone`. Mirror that here.
        updateCallbackDone = Promise.resolve().then(() => captured!());
        return { updateCallbackDone } as unknown;
      };
      teardown = manageNavTransitions({
        awaitNavigation: () => Promise.reject(new Error('loader failed')),
      });
      navigate('/await-reject');
      // Let microtasks drain so the inner promise actually rejects and
      // our `.catch` handler fires.
      await Promise.resolve();
      await updateCallbackDone!.catch(() => {});
      await Promise.resolve();
      expect(
        errors.some(
          (args) =>
            typeof args[0] === 'string' &&
            (args[0] as string).includes('view-transition callback rejected'),
        ),
      ).toBe(true);
    } finally {
      console.error = origError;
    }
  });

  // Finding: `_setNavigateWrapper` is single-slot (last writer wins).
  // Without coordination, the teardown from the FIRST manageNavTransitions
  // call would null out a SECOND caller's wrapper. CAS check fixes this.
  it('teardown from an earlier manageNavTransitions does not clobber a later install', () => {
    const callsA: number[] = [];
    const callsB: number[] = [];
    let activeCounter = callsA;
    (document as DocStub).startViewTransition = (cb) => {
      activeCounter.push(1);
      (cb as () => void)();
      return {} as unknown;
    };
    const teardownA = manageNavTransitions();
    const teardownB = manageNavTransitions();
    // Tearing down A should NOT remove B's wrapper — B was installed last.
    teardownA();
    activeCounter = callsB;
    navigate('/post-a-teardown');
    expect(callsB.length).toBe(1);
    expect(window.location.pathname).toBe('/post-a-teardown');
    teardownB();
    navigate('/post-b-teardown');
    expect(callsB.length).toBe(1);
    teardown = null;
  });

  // Finding (MED): a re-entrant navigate() arriving while a prior
  // awaitNavigation is still pending should signal the prior thunk so
  // its loaders can short-circuit. Wrapper threads an AbortSignal via
  // the third callback arg.
  it('aborts a pending awaitNavigation when a new navigation supersedes it', async () => {
    const captured: Array<() => Promise<void>> = [];
    (document as DocStub).startViewTransition = (cb) => {
      captured.push(cb as () => Promise<void>);
      return {} as unknown;
    };
    const seenSignals: AbortSignal[] = [];
    teardown = manageNavTransitions({
      awaitNavigation: (_url, _replace, { signal }) => {
        seenSignals.push(signal);
        // Never resolves on its own — only the abort can release it.
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        });
      },
    });
    navigate('/first');
    const first = captured[0]!();
    await Promise.resolve();
    expect(seenSignals.length).toBe(1);
    expect(seenSignals[0].aborted).toBe(false);
    // Re-entrant navigation while the first awaitNavigation is still
    // pending — must abort the first signal.
    navigate('/second');
    const second = captured[1]!();
    await Promise.resolve();
    expect(seenSignals[0].aborted).toBe(true);
    expect(seenSignals[1].aborted).toBe(false);
    // First should resolve once we let the abort handler run.
    await first;
    // Now abort the second by tearing down.
    teardown!();
    teardown = null;
    await second;
    expect(seenSignals[1].aborted).toBe(true);
  });

  // Finding (MED): teardown should signal cancellation to any in-flight
  // awaitNavigation so its consumers (fetch, loaders) stop wasting work
  // against an unmounted scope.
  it('aborts an in-flight awaitNavigation when teardown runs', async () => {
    let captured: (() => Promise<void>) | null = null;
    (document as DocStub).startViewTransition = (cb) => {
      captured = cb as () => Promise<void>;
      return {} as unknown;
    };
    let observedSignal: AbortSignal | null = null;
    teardown = manageNavTransitions({
      awaitNavigation: (_url, _replace, { signal }) => {
        observedSignal = signal;
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve());
        });
      },
    });
    navigate('/will-be-aborted');
    const settle = captured!();
    await Promise.resolve();
    expect(observedSignal).not.toBeNull();
    expect((observedSignal as unknown as AbortSignal).aborted).toBe(false);
    teardown!();
    teardown = null;
    await settle;
    expect((observedSignal as unknown as AbortSignal).aborted).toBe(true);
  });

  // Finding: abort-driven updateCallbackDone rejections should not
  // pollute the console (re-entrant nav, teardown — expected outcomes).
  it('does not log an error for AbortError rejections in updateCallbackDone', async () => {
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      let captured: (() => Promise<void>) | null = null;
      let updateCallbackDone: Promise<unknown> | undefined;
      (document as DocStub).startViewTransition = (cb) => {
        captured = cb as () => Promise<void>;
        updateCallbackDone = Promise.resolve().then(() => captured!());
        return { updateCallbackDone } as unknown;
      };
      teardown = manageNavTransitions({
        awaitNavigation: () => {
          // Synthesize a DOMException-style AbortError — matches what
          // `fetch(url, { signal })` throws after an abort.
          const err = new Error('aborted') as Error & { name: string };
          err.name = 'AbortError';
          return Promise.reject(err);
        },
      });
      navigate('/aborted');
      await updateCallbackDone!.catch(() => {});
      await Promise.resolve();
      expect(
        errors.some(
          (args) =>
            typeof args[0] === 'string' &&
            (args[0] as string).includes('view-transition callback rejected'),
        ),
      ).toBe(false);
    } finally {
      console.error = origError;
    }
  });
});
