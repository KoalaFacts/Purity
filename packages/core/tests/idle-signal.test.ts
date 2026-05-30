// @vitest-environment jsdom
// ADR 0042 — idleSignal tests.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { component, idleSignal, type IdleDetectorLike, mount, watch } from '../src/index.ts';
import { _evictIdleSignal } from '../src/idle-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext, tick } from './_helpers.ts';

class MockIdleDetector extends EventTarget implements IdleDetectorLike {
  userState: 'active' | 'idle' = 'active';
  screenState: 'locked' | 'unlocked' = 'unlocked';
  emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

afterEach(() => {
  // Drop any spies installed on EventTarget for the leak/double-bind tests.
  vi.restoreAllMocks();
});

describe('idleSignal (ADR 0042)', () => {
  it('returns the default constant in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const detector = new MockIdleDetector();
      expect(idleSignal(detector)()).toEqual({ user: 'active', screen: 'unlocked' });
    } finally {
      popSSRRenderContext();
    }
  });

  it('reads detector userState / screenState on first read', () => {
    const detector = new MockIdleDetector();
    detector.userState = 'idle';
    detector.screenState = 'locked';
    expect(idleSignal(detector)()).toEqual({ user: 'idle', screen: 'locked' });
  });

  it('updates on detector `change` event', () => {
    const detector = new MockIdleDetector();
    const s = idleSignal(detector);
    expect(s()).toEqual({ user: 'active', screen: 'unlocked' });
    detector.userState = 'idle';
    detector.emit();
    expect(s()).toEqual({ user: 'idle', screen: 'unlocked' });
    detector.screenState = 'locked';
    detector.emit();
    expect(s()).toEqual({ user: 'idle', screen: 'locked' });
  });

  it('falls back to defaults when detector fields are undefined', () => {
    const detector = new EventTarget() as IdleDetectorLike;
    expect(idleSignal(detector)()).toEqual({ user: 'active', screen: 'unlocked' });
  });

  // ---------------------------------------------------------------------
  // Regression — audit-v2 hardening.
  // ---------------------------------------------------------------------

  it('returns the same accessor for repeat calls with the same detector (no double-bind)', () => {
    const detector = new MockIdleDetector();
    const a = idleSignal(detector);
    const b = idleSignal(detector);
    expect(a).toBe(b);
    _evictIdleSignal(detector);
  });

  it('attaches only ONE `change` listener even when called multiple times', () => {
    const detector = new MockIdleDetector();
    const addSpy = vi.spyOn(detector, 'addEventListener');
    idleSignal(detector);
    idleSignal(detector);
    idleSignal(detector);
    const changeListenerAdds = addSpy.mock.calls.filter((c) => c[0] === 'change').length;
    expect(changeListenerAdds).toBe(1);
    _evictIdleSignal(detector);
  });

  it('isolates throwing detector state getters and falls back to defaults', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const detector = new EventTarget() as IdleDetectorLike;
    Object.defineProperty(detector, 'userState', {
      get() {
        throw new Error('not started yet');
      },
    });
    expect(idleSignal(detector)()).toEqual({ user: 'active', screen: 'unlocked' });
    expect(errSpy).toHaveBeenCalled();
    _evictIdleSignal(detector);
  });

  it('does not throw when the detector lacks addEventListener (degraded env)', () => {
    // Strip addEventListener to simulate a partial polyfill / non-EventTarget shape.
    const detector = {
      userState: 'idle' as const,
      screenState: 'locked' as const,
    } as unknown as IdleDetectorLike;
    expect(() => idleSignal(detector)).not.toThrow();
    expect(idleSignal(detector)()).toEqual({ user: 'idle', screen: 'locked' });
    _evictIdleSignal(detector);
  });

  it('catches an exception thrown from inside the change handler path', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const detector = new MockIdleDetector();
    const s = idleSignal(detector);
    // Now make state reads throw — emitting `change` must not propagate.
    let throwing = false;
    Object.defineProperty(detector, 'userState', {
      configurable: true,
      get() {
        if (throwing) throw new Error('boom');
        return 'idle';
      },
    });
    throwing = true;
    expect(() => detector.emit()).not.toThrow();
    expect(s()).toEqual({ user: 'active', screen: 'unlocked' }); // unchanged
    expect(errSpy).toHaveBeenCalled();
    _evictIdleSignal(detector);
  });

  it('detaches the `change` listener on component dispose (no listener leak)', async () => {
    const detector = new MockIdleDetector();
    const removeSpy = vi.spyOn(detector, 'removeEventListener');
    let captured: ReturnType<typeof idleSignal> | null = null;

    const App = component('p-idle-host', () => {
      captured = idleSignal(detector);
      return document.createElement('span');
    });

    const root = document.createElement('div');
    document.body.appendChild(root);
    const { unmount } = mount(App, root);
    await tick();
    expect(captured).not.toBeNull();

    unmount();
    await tick();

    // Either removeEventListener was called OR the AbortController was
    // honoured. Verify behavior by emitting after unmount and confirming
    // the signal did NOT update.
    const before = captured!();
    detector.userState = 'idle';
    detector.screenState = 'locked';
    detector.emit();
    await tick();
    expect(captured!()).toEqual(before);

    // For defence-in-depth we also check removeEventListener was called,
    // since jsdom does honour the `signal` option but we add the explicit
    // remove for partial-polyfill safety.
    expect(removeSpy).toHaveBeenCalledWith('change', expect.any(Function));

    document.body.removeChild(root);
  });

  it('integrates with watch() — sees every emit as a fresh snapshot', async () => {
    const detector = new MockIdleDetector();
    const s = idleSignal(detector);
    const seen: string[] = [];
    const stop = watch(() => seen.push(s().user));
    detector.userState = 'idle';
    detector.emit();
    await tick();
    // Each emit produces a new object snapshot; Object.is on the new state
    // is false, so watch fires again. This is intentional signal semantics.
    expect(seen).toContain('idle');
    expect(seen[0]).toBe('active');
    stop();
    _evictIdleSignal(detector);
  });
});
