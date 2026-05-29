// @vitest-environment jsdom
// ADR 0039 — broadcastSignal tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { broadcastSignal, watch } from '../src/index.ts';
import { _resetBroadcastSignalCache } from '../src/broadcast-signal.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));
// jsdom delivers BroadcastChannel messages on a macrotask, not microtask.
const flushBC = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

// Common validators used across tests.
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isString = (v: unknown): v is string => typeof v === 'string';
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumberOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number';
const isXObj = (v: unknown): v is { x: number } =>
  !!v && typeof v === 'object' && typeof (v as { x?: unknown }).x === 'number';

beforeEach(() => {
  _resetBroadcastSignalCache();
});

describe('broadcastSignal — SSR path (ADR 0039)', () => {
  it('returns a plain state with the default on the server (no channel opened)', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const sig = broadcastSignal<string | null>('auth-ssr', null, isStringOrNull);
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
    const sig = broadcastSignal<string | null>('auth-default', null, isStringOrNull);
    expect(sig()).toBeNull();
  });

  it('updates the local signal on set + accessor call + updater', () => {
    const sig = broadcastSignal<number>('counter', 0, isNumber);
    sig.set(5);
    expect(sig()).toBe(5);
    sig(10);
    expect(sig()).toBe(10);
    sig((v) => v + 1);
    expect(sig()).toBe(11);
  });

  it('participates in reactive tracking', async () => {
    const sig = broadcastSignal<number>('react-counter', 0, isNumber);
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
    const a = broadcastSignal<number>('shared', 7, isNumber);
    const b = broadcastSignal<number>('shared', 999, isNumber); // default ignored on second call
    expect(a).toBe(b);
    expect(b()).toBe(7);
    b.set(42);
    expect(a()).toBe(42);
    warnSpy.mockRestore();
  });

  it('warns when a second call passes a different default for the same channel', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    broadcastSignal<number>('warn-diff', 1, isNumber);
    broadcastSignal<number>('warn-diff', 2, isNumber);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("broadcastSignal('warn-diff')");
    warnSpy.mockRestore();
  });

  it('does not warn when a second call passes the same default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    broadcastSignal<number>('warn-same', 7, isNumber);
    broadcastSignal<number>('warn-same', 7, isNumber);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('cross-tab message updates the signal when validator accepts', async () => {
    const sig = broadcastSignal<string>('cross', 'initial', isString);
    const peerChannel = new BroadcastChannel('cross');
    peerChannel.postMessage('from-peer');
    await flushBC();
    expect(sig()).toBe('from-peer');
    peerChannel.close();
  });

  it('posts on set, picked up by a peer listener', async () => {
    const sig = broadcastSignal<string>('outgoing', 'a', isString);
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
    const sig = broadcastSignal<{ x: number }>('post-fail', { x: 0 }, isXObj);
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
      const sig = broadcastSignal<number | null>('no-bc', 0, isNumberOrNull);
      sig.set(5);
      expect(sig()).toBe(5);
    } finally {
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = ORIGINAL;
    }
  });
});

describe('broadcastSignal — validator (ADR 0039)', () => {
  it('drops incoming messages that fail the validator', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = broadcastSignal<number>('strict-num', 0, isNumber);
    const peer = new BroadcastChannel('strict-num');
    // Post a poisoned shape — a string instead of a number.
    peer.postMessage('not-a-number');
    await flushBC();
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("broadcastSignal('strict-num')");
    peer.close();
    warnSpy.mockRestore();
  });

  it('accepts validated messages while rejecting poisoned ones interleaved', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sig = broadcastSignal<number>('strict-mix', 0, isNumber);
    const peer = new BroadcastChannel('strict-mix');
    peer.postMessage(42); // accepted
    peer.postMessage({ malicious: true }); // rejected
    peer.postMessage(7); // accepted
    await flushBC();
    expect(sig()).toBe(7);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    peer.close();
    warnSpy.mockRestore();
  });

  it('does not run the validator on local writes', () => {
    // Validator that rejects everything — local writes still succeed because
    // the validator only gates incoming messages.
    const sig = broadcastSignal<number>(
      'no-validate-local',
      0,
      ((_v: unknown): _v is number => false) as (v: unknown) => v is number,
    );
    sig.set(5);
    expect(sig()).toBe(5);
  });

  it('uses the first call’s validator and ignores later validators per channel', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const strictNum = broadcastSignal<number>('first-wins', 0, isNumber);
    // Second call passes a permissive validator — but the first one already
    // installed the strict number predicate, so it stays in force.
    const _ignored = broadcastSignal<number>(
      'first-wins',
      0,
      ((_v: unknown): _v is number => true) as (v: unknown) => v is number,
    );
    expect(strictNum).toBe(_ignored);
    const peer = new BroadcastChannel('first-wins');
    peer.postMessage('still-poisoned');
    await flushBC();
    expect(strictNum()).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    peer.close();
    warnSpy.mockRestore();
  });
});
