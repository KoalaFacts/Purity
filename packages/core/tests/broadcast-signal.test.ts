// @vitest-environment jsdom
// ADR 0039 — broadcastSignal tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { broadcastSignal, watch } from '../src/index.ts';
import { _resetBroadcastSignalRegistry } from '../src/broadcast-signal.ts';
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
  _resetBroadcastSignalRegistry();
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

  it('drops the message and logs when the validator THROWS (not just returns false)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = ((v: unknown): v is number => {
      if (typeof v !== 'number') throw new TypeError('validator hates this');
      return true;
    }) as (v: unknown) => v is number;
    const sig = broadcastSignal<number>('validator-throws', 0, throwing);
    const peer = new BroadcastChannel('validator-throws');
    peer.postMessage({ poisoned: true });
    await flushBC();
    expect(sig()).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('validator threw');
    peer.close();
    warnSpy.mockRestore();
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

// ---------------------------------------------------------------------------
// audit-v2 regression tests — argument validation, listener leak on reset,
// no-op self-echo prevention.
// ---------------------------------------------------------------------------

describe('broadcastSignal — argument validation (audit-v2)', () => {
  it('throws TypeError when validate is not a function', () => {
    expect(() =>
      broadcastSignal<number>('bad-validate', 0, null as unknown as (v: unknown) => v is number),
    ).toThrow(TypeError);
    expect(() =>
      broadcastSignal<number>(
        'bad-validate-2',
        0,
        undefined as unknown as (v: unknown) => v is number,
      ),
    ).toThrow(/validate.*must be a type-predicate function/);
    expect(() =>
      broadcastSignal<number>(
        'bad-validate-3',
        0,
        'nope' as unknown as (v: unknown) => v is number,
      ),
    ).toThrow(TypeError);
  });

  it('throws TypeError when channel name is empty or wrong type', () => {
    expect(() => broadcastSignal<number>('', 0, isNumber)).toThrow(/non-empty string/);
    expect(() => broadcastSignal<number>(null as unknown as string, 0, isNumber)).toThrow(
      /non-empty string/,
    );
    expect(() => broadcastSignal<number>(42 as unknown as string, 0, isNumber)).toThrow(
      /non-empty string/,
    );
  });
});

describe('broadcastSignal — listener leak / double-init (audit-v2)', () => {
  it('closes the underlying channel on registry reset (no leaked listener)', async () => {
    // First incarnation: stash the signal, then reset.
    let received = 0;
    const before = broadcastSignal<number>('leak-check', 0, isNumber);
    const offWatch = watch(() => {
      // touch the signal to ensure tracking is wired
      before();
      received++;
    });
    // Reset — the previous BroadcastChannel must be closed so the
    // next set() to a fresh same-named instance won't be forwarded
    // back into the stale listener.
    _resetBroadcastSignalRegistry();
    offWatch();

    // Brand-new incarnation under the same channel name.
    const fresh = broadcastSignal<number>('leak-check', 0, isNumber);
    expect(fresh).not.toBe(before); // proves we got a new signal, not the old one
    const peer = new BroadcastChannel('leak-check');
    peer.postMessage(99);
    await flushBC();
    expect(fresh()).toBe(99);
    // The stale signal MUST NOT have updated — its channel is closed.
    expect(before()).toBe(0);
    peer.close();
    // ensure no NaN noise from received
    expect(received).toBeGreaterThanOrEqual(1);
  });

  it('_resetBroadcastSignalRegistry is idempotent (no throw on second call)', () => {
    broadcastSignal<number>('idempotent-reset', 0, isNumber);
    _resetBroadcastSignalRegistry();
    expect(() => _resetBroadcastSignalRegistry()).not.toThrow();
  });
});

describe('broadcastSignal — message storm / no-op writes (audit-v2)', () => {
  it('does not post when set() writes the same value (Object.is equal)', async () => {
    const sig = broadcastSignal<number>('no-op-set', 7, isNumber);
    const received: number[] = [];
    const peer = new BroadcastChannel('no-op-set');
    peer.addEventListener('message', (e: MessageEvent) => {
      received.push(e.data as number);
    });
    sig.set(7); // no-op vs default → must NOT post
    sig.set(7); // no-op vs current → must NOT post
    sig.set(8); // real change → must post
    sig.set(8); // no-op vs current → must NOT post
    await flushBC();
    expect(received).toEqual([8]);
    peer.close();
  });

  it('does not post when accessor() writes the same value', async () => {
    const sig = broadcastSignal<number>('no-op-accessor', 0, isNumber);
    const received: number[] = [];
    const peer = new BroadcastChannel('no-op-accessor');
    peer.addEventListener('message', (e: MessageEvent) => {
      received.push(e.data as number);
    });
    sig(0); // no-op — default is 0
    sig((v) => v); // identity updater — no change
    sig(1); // change
    sig((v) => v); // identity again — no post
    await flushBC();
    expect(received).toEqual([1]);
    peer.close();
  });
});
