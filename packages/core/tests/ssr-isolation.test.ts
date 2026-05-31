// @vitest-environment jsdom
// SSR-isolation invariant — cross-cutting guard against per-request state
// leaks (the bug class fixed in query() during the deep audit).
//
// THE INVARIANT: under an SSR render context, no signal/data primitive may
// return a cached or shared instance. The module-level caches and lazy
// singletons these primitives keep are process-global and persist across
// requests; touching them on the server would let one request's state bleed
// into another's render. Every primitive must guard SSR *before* any
// module-state access, so two calls under SSR yield independent instances.
//
// This file is the consolidated regression net. Per-primitive behavior is
// covered in each primitive's own test file; here we assert the ONE rule
// that, if upheld everywhere, makes SSR cross-request leakage impossible.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  batterySignal,
  bfcacheRestoreSignal,
  broadcastSignal,
  devicePixelRatioSignal,
  fullscreenSignal,
  localSignal,
  localeSignal,
  mediaSignal,
  networkInformationSignal,
  onlineSignal,
  pageLifecycleSignal,
  pageVisibilitySignal,
  permissionSignal,
  prefersColorSchemeSignal,
  prefersContrastSignal,
  prefersReducedMotionSignal,
  query,
  screenOrientationSignal,
} from '../src/index.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

// Reset hooks for every module-state primitive, run between cases so a
// stray client-path call in one test can't taint the next.
import { _resetBatterySignal } from '../src/battery-signal.ts';
import { _resetBfcacheRestoreSignal } from '../src/bfcache-restore-signal.ts';
import { _resetBroadcastSignalRegistry } from '../src/broadcast-signal.ts';
import { _resetDevicePixelRatioSignal } from '../src/device-pixel-ratio-signal.ts';
import { _resetFullscreenSignal } from '../src/fullscreen-signal.ts';
import { _resetLocalSignalRegistry } from '../src/local-signal.ts';
import { _resetLocaleSignal } from '../src/locale-signal.ts';
import { _resetMediaSignalCache } from '../src/media-signal.ts';
import { _resetNetworkInformationSignal } from '../src/network-information-signal.ts';
import { _resetOnlineSignal } from '../src/online-signal.ts';
import { _resetPageLifecycleSignal } from '../src/page-lifecycle-signal.ts';
import { _resetPageVisibilitySignal } from '../src/page-visibility-signal.ts';
import { _resetPermissionSignalCache } from '../src/permission-signal.ts';
import { _resetQueryCache } from '../src/query.ts';
import { _resetScreenOrientationSignal } from '../src/screen-orientation-signal.ts';

const isNum = (v: unknown): v is number => typeof v === 'number';

function resetAll(): void {
  _resetBatterySignal();
  _resetBfcacheRestoreSignal();
  _resetBroadcastSignalRegistry();
  _resetDevicePixelRatioSignal();
  _resetFullscreenSignal();
  _resetLocalSignalRegistry();
  _resetLocaleSignal();
  _resetMediaSignalCache();
  _resetNetworkInformationSignal();
  _resetOnlineSignal();
  _resetPageLifecycleSignal();
  _resetPageVisibilitySignal();
  _resetPermissionSignalCache();
  _resetQueryCache();
  _resetScreenOrientationSignal();
}

beforeEach(resetAll);
afterEach(resetAll);

/**
 * Each entry calls its primitive once and returns the result. Running it
 * twice under one SSR context must yield two distinct references — proof
 * that nothing was served from a module-level cache / singleton.
 */
const primitives: Array<[name: string, call: () => unknown]> = [
  ['onlineSignal', () => onlineSignal()],
  ['prefersColorSchemeSignal', () => prefersColorSchemeSignal()],
  ['prefersReducedMotionSignal', () => prefersReducedMotionSignal()],
  ['prefersContrastSignal', () => prefersContrastSignal()],
  ['screenOrientationSignal', () => screenOrientationSignal()],
  ['localeSignal', () => localeSignal()],
  ['devicePixelRatioSignal', () => devicePixelRatioSignal()],
  ['fullscreenSignal', () => fullscreenSignal()],
  ['pageVisibilitySignal', () => pageVisibilitySignal()],
  ['pageLifecycleSignal', () => pageLifecycleSignal()],
  ['bfcacheRestoreSignal', () => bfcacheRestoreSignal()],
  ['batterySignal', () => batterySignal()],
  ['networkInformationSignal', () => networkInformationSignal()],
  ['permissionSignal', () => permissionSignal('camera')],
  ['mediaSignal', () => mediaSignal('(min-width: 600px)')],
  ['broadcastSignal', () => broadcastSignal<number>('ch', 0, isNum)],
  ['localSignal', () => localSignal('k', 0)],
  ['query', () => query({ key: 'k', fetcher: () => Promise.resolve(0), initialValue: 0 })],
];

describe('SSR isolation — no cached/shared instance under an SSR context', () => {
  for (const [name, call] of primitives) {
    it(`${name}: two calls under SSR return independent instances`, () => {
      const ctx = makeSSRContext();
      pushSSRRenderContext(ctx);
      try {
        const a = call();
        const b = call();
        expect(a).not.toBe(b);
      } finally {
        popSSRRenderContext();
      }
    });
  }
});

describe('SSR isolation — server render does not populate the client cache', () => {
  it('query: SSR render leaves the module cache empty (later client call does not warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      query({
        key: 'shared',
        fetcher: () => Promise.resolve('A'),
        initialValue: null,
        staleTime: 1,
      });
    } finally {
      popSSRRenderContext();
    }
    // A client call with the same key but different config would warn ONLY
    // if it hit a cached entry. Silence proves the SSR render cached nothing.
    query({
      key: 'shared',
      fetcher: () => Promise.resolve('B'),
      initialValue: null,
      staleTime: 999,
    });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('broadcastSignal: SSR render leaves the channel cache empty (later client call does not warn)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      broadcastSignal<number>('auth', 1, isNum);
    } finally {
      popSSRRenderContext();
    }
    // Different default for the same channel warns ONLY on a cache hit.
    broadcastSignal<number>('auth', 2, isNum);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('localSignal: SSR render performs no storage write and leaves no registry entry', () => {
    localStorage.clear();
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const sig = localSignal('persisted', 'default');
      sig.set('mutated-during-ssr');
    } finally {
      popSSRRenderContext();
    }
    // SSR localSignal is a plain in-memory state — nothing touched storage.
    expect(localStorage.getItem('persisted')).toBeNull();
  });
});

describe('SSR isolation — two sequential renders never share state', () => {
  it('query: render A and render B with the same key are fully independent', () => {
    const ctxA = makeSSRContext();
    pushSSRRenderContext(ctxA);
    let qA: ReturnType<typeof query<string>>;
    try {
      qA = query({ key: 'iso', fetcher: () => Promise.resolve('A'), initialValue: '' });
    } finally {
      popSSRRenderContext();
    }
    const ctxB = makeSSRContext();
    pushSSRRenderContext(ctxB);
    let qB: ReturnType<typeof query<string>>;
    try {
      qB = query({ key: 'iso', fetcher: () => Promise.resolve('B'), initialValue: '' });
    } finally {
      popSSRRenderContext();
    }
    expect(qA).not.toBe(qB);
    expect(ctxA.pendingPromises.length).toBeGreaterThanOrEqual(1);
    expect(ctxB.pendingPromises.length).toBeGreaterThanOrEqual(1);
  });

  it('broadcastSignal: render A and render B with the same channel get independent state', () => {
    const ctxA = makeSSRContext();
    pushSSRRenderContext(ctxA);
    let a: ReturnType<typeof broadcastSignal<number>>;
    try {
      a = broadcastSignal<number>('shared', 0, isNum);
      a.set(10);
    } finally {
      popSSRRenderContext();
    }
    const ctxB = makeSSRContext();
    pushSSRRenderContext(ctxB);
    try {
      const b = broadcastSignal<number>('shared', 0, isNum);
      // B must NOT see A's write — distinct per-render state.
      expect(b()).toBe(0);
      expect(b).not.toBe(a);
    } finally {
      popSSRRenderContext();
    }
  });
});
