// @vitest-environment jsdom
// ADR 0039 — broadcastSignal tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { broadcastSignal, watch } from '../src/index.ts';
import { _resetBroadcastSignalRegistry } from '../src/broadcast-signal.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));
// jsdom delivers BroadcastChannel messages on a macrotask, not microtask.
const flushBC = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

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

beforeEach(() => {
  _resetBroadcastSignalRegistry();
});

describe('broadcastSignal — SSR path (ADR 0039)', () => {
  it('returns a plain state with the default on the server (no channel opened)', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const sig = broadcastSignal('auth-ssr', null as string | null);
      expect(sig()).toBeNull();
      sig.set('token');
      expect(sig()).toBe('token');
    } finally {
      popSSRRenderContext();
    }
  });
});

describe('broadcastSignal — client path (ADR 0039)', () => {
  it('returns the default value initially', () => {
    const sig = broadcastSignal<string | null>('auth-default', null);
    expect(sig()).toBeNull();
  });

  it('updates the local signal on set + accessor call + updater', () => {
    const sig = broadcastSignal<number>('counter', 0);
    sig.set(5);
    expect(sig()).toBe(5);
    sig(10);
    expect(sig()).toBe(10);
    sig((v) => v + 1);
    expect(sig()).toBe(11);
  });

  it('participates in reactive tracking', async () => {
    const sig = broadcastSignal<number>('react-counter', 0);
    const seen: number[] = [];
    const dispose = watch(() => {
      seen.push(sig());
    });
    sig.set(1);
    await tick();
    sig.set(2);
    await tick();
    expect(seen).toEqual([0, 1, 2]);
    dispose();
  });

  it('shares one instance per channel name', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = broadcastSignal<number>('shared', 7);
    const b = broadcastSignal<number>('shared', 999); // default ignored on second call
    expect(a).toBe(b);
    expect(b()).toBe(7);
    b.set(42);
    expect(a()).toBe(42);
    warnSpy.mockRestore();
  });

  it('warns when a second call passes a different default for the same channel', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    broadcastSignal<number>('warn-diff', 1);
    broadcastSignal<number>('warn-diff', 2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("broadcastSignal('warn-diff')");
    warnSpy.mockRestore();
  });

  it('does not warn when a second call passes the same default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    broadcastSignal<number>('warn-same', 7);
    broadcastSignal<number>('warn-same', 7);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('cross-tab message updates the signal without re-posting', async () => {
    // Open a second BroadcastChannel on the same name; messages we post from
    // it should be received by the signal's internal channel and update
    // the local value.
    const sig = broadcastSignal<string>('cross', 'initial');
    const peerChannel = new BroadcastChannel('cross');
    peerChannel.postMessage('from-peer');
    await flushBC();
    expect(sig()).toBe('from-peer');
    peerChannel.close();
  });

  it('posts on set, picked up by a peer listener', async () => {
    const sig = broadcastSignal<string>('outgoing', 'a');
    const received: string[] = [];
    const peerChannel = new BroadcastChannel('outgoing');
    peerChannel.addEventListener('message', (e: MessageEvent) => {
      received.push(e.data as string);
    });
    sig.set('b');
    sig.set('c');
    await flushBC();
    expect(received).toEqual(['b', 'c']);
    peerChannel.close();
  });

  it('logs (but does not throw) when postMessage fails', () => {
    const sig = broadcastSignal<{ x: number }>('post-fail', { x: 0 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const proto = Object.getPrototypeOf(
      // grab the BroadcastChannel instance to spy on its prototype
      new BroadcastChannel('post-fail-probe'),
    ) as BroadcastChannel;
    const orig = proto.postMessage;
    proto.postMessage = function () {
      throw new Error('cloning failed');
    };
    try {
      expect(() => sig.set({ x: 1 })).not.toThrow();
      expect(sig()).toEqual({ x: 1 });
      expect(errSpy).toHaveBeenCalled();
    } finally {
      proto.postMessage = orig;
      errSpy.mockRestore();
    }
  });

  it('returns a plain state when BroadcastChannel is unavailable', () => {
    const ORIGINAL = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    try {
      const sig = broadcastSignal<number>('no-bc', 0);
      sig.set(5);
      expect(sig()).toBe(5);
    } finally {
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = ORIGINAL;
    }
  });
});
