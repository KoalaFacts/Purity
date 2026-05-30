// @vitest-environment jsdom
// ADR 0040 — mutationSignal tests. MutationObserver is native in jsdom.

import { describe, expect, it } from 'vitest';

import { mount, mutationSignal, watch } from '../src/index.ts';
import { popSSRRenderContext, pushSSRRenderContext } from '../src/ssr-context.ts';
import { makeSSRContext } from './_helpers.ts';

const tick = (): Promise<void> => new Promise((r) => queueMicrotask(r));
const flushMO = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('mutationSignal — SSR (ADR 0040)', () => {
  it('returns a constant empty array in an SSR context', () => {
    const ctx = makeSSRContext();
    pushSSRRenderContext(ctx);
    try {
      const el = document.createElement('div');
      const sig = mutationSignal(el, { childList: true });
      expect(sig()).toEqual([]);
    } finally {
      popSSRRenderContext();
    }
  });
});

describe('mutationSignal — client (ADR 0040)', () => {
  it('starts as an empty array', () => {
    const el = document.createElement('div');
    const sig = mutationSignal(el, { childList: true });
    expect(sig()).toEqual([]);
  });

  it('records child mutations', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const sig = mutationSignal(el, { childList: true });
    el.appendChild(document.createElement('span'));
    await flushMO();
    expect(sig().length).toBeGreaterThanOrEqual(1);
    expect(sig()[0].type).toBe('childList');
    document.body.removeChild(el);
  });

  it('participates in reactive tracking', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const sig = mutationSignal(el, { childList: true });
    let runs = 0;
    const dispose = watch(sig, () => {
      runs++;
    });
    el.appendChild(document.createElement('span'));
    await flushMO();
    await tick();
    expect(runs).toBeGreaterThanOrEqual(1);
    dispose();
    document.body.removeChild(el);
  });

  it('defaults to { childList: true } when no options are passed', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const sig = mutationSignal(el);
    el.appendChild(document.createElement('span'));
    await flushMO();
    expect(sig().length).toBeGreaterThanOrEqual(1);
    document.body.removeChild(el);
  });
});

// ---------------------------------------------------------------------------
// audit-v2 hardening — observer lifecycle, throw isolation, options validation,
// takeRecords drain on dispose, idempotent disconnect.
// ---------------------------------------------------------------------------

describe('mutationSignal — audit-v2 hardening', () => {
  it('rejects options with no observation flags set', () => {
    // MutationObserver.observe() throws a native TypeError when none of
    // childList/attributes/characterData is true. We surface a Purity-tagged
    // error before construction so the call site is identifiable.
    const el = document.createElement('div');
    expect(() => mutationSignal(el, {} as MutationObserverInit)).toThrow(/mutationSignal/);
    expect(() =>
      mutationSignal(el, { subtree: true } as MutationObserverInit),
    ).toThrow(/childList|attributes|characterData/);
  });

  it('disconnects the observer when the surrounding component unmounts', () => {
    // mutationSignal() inside a component must auto-disconnect on unmount.
    // We patch the constructor to count disconnect() calls without losing
    // the native MutationObserver semantics inside jsdom.
    const Native = MutationObserver;
    let disconnects = 0;
    class CountingMO extends Native {
      disconnect(): void {
        disconnects++;
        super.disconnect();
      }
    }
    (globalThis as { MutationObserver: unknown }).MutationObserver = CountingMO;
    try {
      const target = document.createElement('div');
      const host = document.createElement('div');
      const { unmount } = mount(() => {
        mutationSignal(target, { childList: true });
        return document.createComment('m');
      }, host);
      expect(disconnects).toBe(0);
      unmount();
      expect(disconnects).toBe(1);
      // Disposer must be idempotent — calling unmount() again (or a parent
      // disposer firing the same handler) must NOT issue a second
      // disconnect(). Listener-count drift caused real bugs in surrounding
      // observer primitives.
      unmount();
      expect(disconnects).toBe(1);
    } finally {
      (globalThis as { MutationObserver: unknown }).MutationObserver = Native;
    }
  });

  it('drains pending records via takeRecords() on dispose', () => {
    // disconnect() drops any queued-but-undelivered records. Without an
    // explicit takeRecords() on the dispose path, the last batch of
    // mutations before unmount silently disappears.
    const Native = MutationObserver;
    let takeRecordsCalls = 0;
    class DrainingMO extends Native {
      takeRecords(): MutationRecord[] {
        takeRecordsCalls++;
        return super.takeRecords();
      }
    }
    (globalThis as { MutationObserver: unknown }).MutationObserver = DrainingMO;
    try {
      const target = document.createElement('div');
      const host = document.createElement('div');
      const { unmount } = mount(() => {
        mutationSignal(target, { childList: true });
        return document.createComment('m');
      }, host);
      unmount();
      expect(takeRecordsCalls).toBe(1);
    } finally {
      (globalThis as { MutationObserver: unknown }).MutationObserver = Native;
    }
  });
});
