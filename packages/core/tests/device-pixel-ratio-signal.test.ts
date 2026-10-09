// @vitest-environment jsdom
// ADR 0041 — devicePixelRatioSignal tests.

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';

import { devicePixelRatioSignal } from '../src/index.ts';
import { _resetDevicePixelRatioSignal } from '../src/device-pixel-ratio-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import {
  installMatchMediaMock,
  mockMqls,
  uninstallMatchMediaMock,
  makeSSRContext,
} from './_helpers.ts';

function setDpr(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value });
}

beforeEach(() => {
  _resetDevicePixelRatioSignal();
  installMatchMediaMock();
  setDpr(1);
});

afterEach(() => {
  uninstallMatchMediaMock();
  _resetDevicePixelRatioSignal();
});

describe('devicePixelRatioSignal (ADR 0041)', () => {
  it('returns a constant `1` in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      expect(devicePixelRatioSignal()()).toBe(1);
    } finally {
      popSSRRenderContext();
    }
  });

  it('reflects window.devicePixelRatio on first read', () => {
    setDpr(2);
    expect(devicePixelRatioSignal()()).toBe(2);
  });

  it('rebinds to a new media query when DPR changes', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    expect(mockMqls.has('(resolution: 1dppx)')).toBe(true);

    // Simulate DPR change: update navigator, then fire the existing mql's
    // change event (it would stop matching).
    setDpr(2);
    mockMqls.get('(resolution: 1dppx)')!.setMatches(false);
    expect(s()).toBe(2);
    expect(mockMqls.has('(resolution: 2dppx)')).toBe(true);
  });

  it('returns the same singleton across calls', () => {
    expect(devicePixelRatioSignal()).toBe(devicePixelRatioSignal());
  });

  it('detaches the listener from the prior MQL when rebinding (no leak)', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;
    expect(oneDppx.listeners.length).toBe(1);

    setDpr(2);
    oneDppx.setMatches(false);
    expect(s()).toBe(2);
    // Previous MQL must have no listener attached anymore.
    expect(oneDppx.listeners.length).toBe(0);
    // New MQL has exactly one listener.
    const twoDppx = mockMqls.get('(resolution: 2dppx)')!;
    expect(twoDppx.listeners.length).toBe(1);
  });

  it('does not stack listeners when the runtime returns the same MQL for the same query', () => {
    // The mock dedupes by query string — same MQL identity across calls.
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);

    // Oscillate 1 → 2 → 1 → 2; same MQL instance is reused per query.
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;
    setDpr(2);
    oneDppx.setMatches(false);
    const twoDppx = mockMqls.get('(resolution: 2dppx)')!;

    setDpr(1);
    twoDppx.setMatches(false);
    setDpr(2);
    oneDppx.setMatches(false);

    expect(s()).toBe(2);
    // After the cycle, only the active (2dppx) MQL holds a single listener;
    // the inactive one is fully detached.
    expect(twoDppx.listeners.length).toBe(1);
    expect(oneDppx.listeners.length).toBe(0);
  });

  it('ignores spurious change events when DPR has not actually changed', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    // Fire change without mutating window.devicePixelRatio. Must NOT rebind to
    // a new MQL or stack a listener on the cached 1dppx instance.
    oneDppx.setMatches(false);
    expect(s()).toBe(1);
    expect(oneDppx.listeners.length).toBe(1);
    // No phantom MQL created for the no-op rebind.
    expect(mockMqls.size).toBe(1);
  });

  it('survives matchMedia throwing during rebind (keeps previous binding live)', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    // Make the next matchMedia call throw — the rebind path must bail
    // cleanly without leaving us listener-less or state-desynced.
    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = () => {
      throw new Error('hostile engine');
    };
    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();
    // State must NOT have advanced if the new MQL couldn't be created —
    // otherwise the signal value diverges from the actively-bound query.
    expect(s()).toBe(1);
    // Old listener must still be attached so we observe future changes.
    expect(oneDppx.listeners.length).toBe(1);

    // Restore + verify a subsequent successful rebind still works.
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;
    oneDppx.setMatches(false);
    expect(s()).toBe(2);
  });

  it('settles correctly when the initial attach fires onChange synchronously', () => {
    // The initial attach stores its detach for the rebind handler to read
    // later. If that storage only happens after the attach CALL returns, a
    // hostile target that invokes `onChange` synchronously from inside the
    // attach call itself (the same class of target the re-entrance guard
    // below already defends against) would see that storage as still
    // empty, throw trying to call it, and the rebind handler would
    // misinterpret the throw as "detach failed" and roll back to the stale
    // DPR — even though nothing was ever actually double-bound.
    setDpr(1);
    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      q: string,
    ) => {
      const m = originalMm(q);
      if (q === '(resolution: 1dppx)') {
        const origAdd = m.addEventListener.bind(m);
        let firstAttach = true;
        (m as unknown as { addEventListener: typeof m.addEventListener }).addEventListener = ((
          t: 'change',
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          origAdd(t, cb);
          if (firstAttach) {
            firstAttach = false;
            setDpr(2);
            // Simulate a hostile engine firing change synchronously inside
            // the very first (initial, not rebind) attach call.
            cb({ matches: false, media: q } as MediaQueryListEvent);
          }
        }) as typeof m.addEventListener;
      }
      return m;
    };
    let s: ReturnType<typeof devicePixelRatioSignal>;
    expect(() => {
      s = devicePixelRatioSignal();
    }).not.toThrow();
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;
    expect(s!()).toBe(2);
  });

  it('does not leak the initial listener when the target fires onChange BEFORE finishing its own registration', () => {
    // Stronger/adversarial variant of the test above: here the hostile
    // target invokes the callback synchronously BEFORE storing it in its
    // own internal listener registry (as opposed to register-then-fire).
    // From the caller's side this is indistinguishable, at the moment
    // onChange fires, from "not registered yet" — attempting to detach
    // right then would be a no-op against a target that hasn't stored the
    // callback, silently leaking it once the target finishes registering
    // moments later. The fix must defer any detach attempt until we're
    // safely outside this attach call entirely.
    setDpr(1);
    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      q: string,
    ) => {
      const m = originalMm(q);
      if (q === '(resolution: 1dppx)') {
        const origAdd = m.addEventListener.bind(m);
        let firstAttach = true;
        (m as unknown as { addEventListener: typeof m.addEventListener }).addEventListener = ((
          t: 'change',
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          if (firstAttach) {
            firstAttach = false;
            setDpr(2);
            cb({ matches: false, media: q } as MediaQueryListEvent); // fires BEFORE registering
          }
          origAdd(t, cb); // registers after
        }) as typeof m.addEventListener;
      }
      return m;
    };
    let s: ReturnType<typeof devicePixelRatioSignal>;
    expect(() => {
      s = devicePixelRatioSignal();
    }).not.toThrow();
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;
    expect(s!()).toBe(2);
    // The deferred recheck must run AFTER the whole attach call (including
    // the real registration above) returns — by which point detaching
    // oneDppx is a genuine, successful removal, not a no-op against a
    // not-yet-registered callback.
    expect(mockMqls.get('(resolution: 1dppx)')!.listeners.length).toBe(0);
  });

  it('keeps the new binding (does not roll back) when detaching the previous MQL throws', () => {
    // devicePixelRatioSignal's detach contract: a throwing detach must
    // propagate to the rebind handler, which decides what to do about it.
    // This is the opposite contract from mediaSignal's detach, which
    // always swallows — the two must not be unified onto one throw/swallow
    // behavior even though the attach/detach branch-selection is shared.
    //
    // What the rebind handler DOES with that throw: a throw from detach
    // doesn't tell us whether the old listener actually got removed before
    // the target threw — there's no way to observe that from here. Rolling
    // back (treating it as "definitely still attached") risks the WORSE
    // outcome if removal actually succeeded: neither MQL ends up
    // subscribed, freezing the signal forever. Keeping the new binding
    // risks only a listener leak on the old MQL in the opposite case —
    // strictly less bad, since the signal keeps updating either way.
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;
    expect(oneDppx.listeners.length).toBe(1);

    oneDppx.removeEventListener = () => {
      throw new Error('detach boom');
    };

    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();

    // Rebind proceeds: the signal advances to the new DPR and the new
    // MQL's listener stays attached, rather than being rolled back.
    expect(s()).toBe(2);
    const twoDppx = mockMqls.get('(resolution: 2dppx)')!;
    expect(twoDppx.listeners.length).toBe(1);
  });

  it('cleans up a partially-registered replacement when attaching it throws after registering', () => {
    // A hostile/buggy target can genuinely register the listener and THEN
    // throw anyway. Losing track of that registration (by just restoring
    // the previous binding) would leak it forever — nothing would ever
    // reference it again.
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      q: string,
    ) => {
      const m = originalMm(q);
      if (q === '(resolution: 2dppx)') {
        const origAdd = m.addEventListener.bind(m);
        (m as unknown as { addEventListener: typeof m.addEventListener }).addEventListener = ((
          t: 'change',
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          origAdd(t, cb); // genuinely registers...
          throw new Error('registered but then threw'); // ...then throws anyway
        }) as typeof m.addEventListener;
      }
      return m;
    };

    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;

    // Rebind aborted (attach reported failure via throw): value stays old,
    // old listener still live, and the partially-registered new listener
    // was cleaned up rather than left dangling with no tracked reference.
    expect(s()).toBe(1);
    expect(oneDppx.listeners.length).toBe(1);
    const twoDppx = mockMqls.get('(resolution: 2dppx)')!;
    expect(twoDppx.listeners.length).toBe(0);
  });

  it('does not lose a genuine DPR change that happens synchronously during a rebind (reprocesses after settling)', () => {
    // The re-entrance guard must defer, not drop: if the replacement MQL's
    // own attach call synchronously triggers ANOTHER real DPR change
    // (distinct from the no-op "attach fires the same transition again"
    // case covered by the infinite-loop test below), that change must
    // still be observed once the in-flight rebind finishes settling —
    // otherwise the signal gets stuck reporting a DPR that's already
    // stale by the time the rebind completes.
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      q: string,
    ) => {
      const m = originalMm(q);
      if (q === '(resolution: 2dppx)') {
        const origAdd = m.addEventListener.bind(m);
        let fired = false;
        (m as unknown as { addEventListener: typeof m.addEventListener }).addEventListener = ((
          t: 'change',
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          origAdd(t, cb);
          if (!fired) {
            fired = true;
            setDpr(3);
            cb({ matches: false, media: q } as MediaQueryListEvent);
          }
        }) as typeof m.addEventListener;
      }
      return m;
    };

    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;

    expect(s()).toBe(3);
    expect(mockMqls.has('(resolution: 3dppx)')).toBe(true);
  });

  it('does not recurse into a stack overflow when a persistently-failing replacement also fires onChange synchronously', () => {
    // Combines two adversarial behaviors from the SAME attach call: the
    // replacement fires onChange synchronously (deferring via
    // settling/pendingRecheck, per the test above) AND then throws. DPR
    // never actually changes between attempts here and this mql always
    // fails the same way — a `finally` that unconditionally retried on
    // `pendingRecheck` would retry the identical failing attach forever.
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      q: string,
    ) => {
      const m = originalMm(q);
      if (q === '(resolution: 2dppx)') {
        const origAdd = m.addEventListener.bind(m);
        (m as unknown as { addEventListener: typeof m.addEventListener }).addEventListener = ((
          t: 'change',
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          origAdd(t, cb);
          cb({ matches: false, media: q } as MediaQueryListEvent);
          throw new Error('always fails');
        }) as typeof m.addEventListener;
      }
      return m;
    };

    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;

    // Rebind never succeeds (2dppx always throws): value stays at the old
    // DPR, old listener stays live, and the deferred recheck triggered by
    // the synchronous fire must not retry the identical failing attach.
    expect(s()).toBe(1);
    expect(oneDppx.listeners.length).toBe(1);
  });

  it('does not infinite-loop when the change handler re-enters synchronously', () => {
    setDpr(1);
    const s = devicePixelRatioSignal();
    expect(s()).toBe(1);
    const oneDppx = mockMqls.get('(resolution: 1dppx)')!;

    // Wrap the 2dppx attach so attaching a listener synchronously fires a
    // nested change event — the re-entrance guard must drop it.
    const originalMm = window.matchMedia;
    (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
      q: string,
    ) => {
      const m = originalMm(q);
      if (q === '(resolution: 2dppx)') {
        const origAdd = m.addEventListener.bind(m);
        let firstAttach = true;
        (m as unknown as { addEventListener: typeof m.addEventListener }).addEventListener = ((
          t: 'change',
          cb: (e: MediaQueryListEvent) => void,
        ) => {
          origAdd(t, cb);
          if (firstAttach) {
            firstAttach = false;
            // Simulate a hostile engine firing change synchronously inside attach.
            cb({ matches: false, media: q } as MediaQueryListEvent);
          }
        }) as typeof m.addEventListener;
      }
      return m;
    };

    setDpr(2);
    expect(() => oneDppx.setMatches(false)).not.toThrow();
    (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = originalMm;
    expect(s()).toBe(2);
  });

  it('falls back to a constant when matchMedia is missing entirely', () => {
    _resetDevicePixelRatioSignal();
    uninstallMatchMediaMock();
    setDpr(3);
    expect(devicePixelRatioSignal()()).toBe(1);
    // Re-install mock for afterEach cleanup symmetry.
    installMatchMediaMock();
  });
});
