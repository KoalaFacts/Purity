// @vitest-environment jsdom
// ADR 0042 — idleSignal tests.

import { describe, expect, it } from 'vitest';

import { idleSignal, type IdleDetectorLike } from '../src/index.ts';
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

class MockIdleDetector extends EventTarget implements IdleDetectorLike {
  userState: 'active' | 'idle' = 'active';
  screenState: 'locked' | 'unlocked' = 'unlocked';
  emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

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
});
