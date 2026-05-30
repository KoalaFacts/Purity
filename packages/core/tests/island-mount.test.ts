// @vitest-environment jsdom
// Tests for `mountIslands(views)` — ADR 0038 Phase 2.
//
// mountIslands walks the document for `<purity-island data-pi-id="N">`
// wrappers, looks up each view by 1-based index, and schedules
// hydration per the wrapper's data-pi-trigger. Phase 2 implements 'load'
// and 'visible'; the other triggers fall back to 'load' until Phase 4.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { island } from '../src/island.ts';
import { mountIslands } from '../src/island-mount.ts';
import { state } from '../src/signals.ts';
import { tick } from './_helpers.ts';

function makeWrapper(id: number, trigger: string, inner: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = `<purity-island data-pi-id="${id}" data-pi-trigger="${trigger}" style="display:contents">${inner}</purity-island>`;
  document.body.appendChild(div);
  return div;
}

describe('mountIslands() — load trigger', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    if (host) host.remove();
    host = null;
  });

  it('hydrates an html-rooted island so reactive text updates work', async () => {
    const count = state(0);
    const View = (): unknown => html`<p><!--[-->${() => count()}<!--]--></p>`;
    host = makeWrapper(1, 'load', '<p><!--[-->0<!--]--></p>');

    mountIslands([island(View)]);
    await tick();

    expect(host.textContent).toBe('0');
    count(7);
    await tick();
    expect(host.textContent).toBe('7');
  });

  it('attaches event handlers to existing SSR elements via the brand view', async () => {
    let clicks = 0;
    const View = (): unknown => html`<button @click=${() => clicks++}>x</button>`;
    host = makeWrapper(1, 'load', '<button>x</button>');

    mountIslands([island(View)]);
    await tick();

    const btn = host.querySelector('button')!;
    btn.click();
    expect(clicks).toBe(1);
  });

  it('hydrates multiple islands independently in declaration order', async () => {
    const a = state('A');
    const b = state('B');
    const ViewA = (): unknown => html`<i><!--[-->${() => a()}<!--]--></i>`;
    const ViewB = (): unknown => html`<em><!--[-->${() => b()}<!--]--></em>`;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = [
      '<purity-island data-pi-id="1" data-pi-trigger="load" style="display:contents"><i><!--[-->A<!--]--></i></purity-island>',
      '<purity-island data-pi-id="2" data-pi-trigger="load" style="display:contents"><em><!--[-->B<!--]--></em></purity-island>',
    ].join('');
    document.body.appendChild(wrapper);
    host = wrapper;

    mountIslands([island(ViewA), island(ViewB)]);
    await tick();

    expect(wrapper.querySelector('i')!.textContent).toBe('A');
    expect(wrapper.querySelector('em')!.textContent).toBe('B');

    a('A2');
    b('B2');
    await tick();
    expect(wrapper.querySelector('i')!.textContent).toBe('A2');
    expect(wrapper.querySelector('em')!.textContent).toBe('B2');
  });

  it('fires the onMount callback once per hydrated island', async () => {
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');

    const onMount = vi.fn();
    mountIslands([island(View)], { onMount });
    await tick();

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith(1, expect.any(HTMLElement));
  });

  it('a second mountIslands() call does NOT re-hydrate an already-scheduled wrapper', async () => {
    // HMR or a user error that calls mountIslands() twice must not
    // double-arm hydration. Pre-fix the same wrapper got hydrated
    // twice — `interact` islands stacked listeners, `load` islands ran
    // their view + onMount twice.
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');
    const onMount = vi.fn();
    mountIslands([island(View)], { onMount });
    mountIslands([island(View)], { onMount });
    await tick();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('limits scanning to the `root` option', async () => {
    const View = (): unknown => html`<span>x</span>`;
    const outsideRoot = makeWrapper(1, 'load', '<span>x</span>');
    const insideRoot = document.createElement('div');
    insideRoot.innerHTML =
      '<purity-island data-pi-id="1" data-pi-trigger="load" style="display:contents"><span>x</span></purity-island>';
    document.body.appendChild(insideRoot);

    const onMount = vi.fn();
    mountIslands([island(View)], { root: insideRoot, onMount });
    await tick();

    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onMount).toHaveBeenCalledWith(1, insideRoot.querySelector('purity-island'));

    outsideRoot.remove();
    insideRoot.remove();
  });

  it('warns and skips when a wrapper IDs out of range', async () => {
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(7, 'load', '<span>x</span>');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onMount = vi.fn();
    mountIslands([island(View)], { onMount });
    await tick();

    expect(onMount).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('no view at index 6');
    warn.mockRestore();
  });

  it('warns when data-pi-id is not a positive integer', () => {
    const View = (): unknown => html`<span>x</span>`;
    host = document.createElement('div');
    host.innerHTML =
      '<purity-island data-pi-id="abc" data-pi-trigger="load" style="display:contents"><span>x</span></purity-island>';
    document.body.appendChild(host);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountIslands([island(View)]);

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('invalid data-pi-id');
    warn.mockRestore();
  });

  it('falls back to "load" when data-pi-trigger is unknown, with a warning', async () => {
    const count = state(0);
    const View = (): unknown => html`<p><!--[-->${() => count()}<!--]--></p>`;
    host = makeWrapper(1, 'whatever', '<p><!--[-->0<!--]--></p>');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountIslands([island(View)]);
    await tick();

    expect(warn).toHaveBeenCalled();
    count(3);
    await tick();
    expect(host.textContent).toBe('3');
    warn.mockRestore();
  });

  it('is a silent no-op when no wrappers are present in the document', async () => {
    const View = (): unknown => html`<span>x</span>`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountIslands([island(View)]);
    await tick();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('mountIslands() — CE-rooted island via lazy thunk (ADR 0038)', () => {
  // Regression: the CE detection used to run BEFORE resolveEntry awaited
  // the lazy import, so `customElements.get(tag)` was undefined at the
  // time of the check (the chunk hadn't loaded yet). That made
  // mountIslands fall through to hydrate(wrapper, view), which moves the
  // CE through a DocumentFragment — triggering disconnect/reconnect on a
  // Custom Element that had just hydrated via DSD. The fix is to detect
  // the CE root AFTER the lazy chunk resolves.

  let host: HTMLElement | null = null;
  let tagSeq = 0;
  afterEach(() => {
    if (host) host.remove();
    host = null;
  });

  it('detects the registered custom element AFTER the lazy chunk resolves', async () => {
    // A unique tag per test run so multiple test runs don't collide on
    // the CE registry. Define the CE lazily inside the thunk so it isn't
    // registered until the chunk "loads".
    const tag = `lazy-ce-${++tagSeq}`;
    host = document.createElement('div');
    host.innerHTML =
      `<purity-island data-pi-id="1" data-pi-trigger="load" style="display:contents">` +
      `<${tag}></${tag}></purity-island>`;
    document.body.appendChild(host);

    // Sanity: tag isn't registered yet.
    expect(customElements.get(tag)).toBeUndefined();

    let hydrateCalls = 0;
    // The "view" is a plain function — what matters is that the lazy
    // thunk registers the CE during resolution and the runtime then
    // detects it and skips hydrate. We spy on hydrate by counting how
    // many times the thunk's view function is called (which only happens
    // when hydrate(wrapper, view) runs).
    const View = (): unknown => {
      hydrateCalls++;
      return document.createElement('span');
    };
    const Wrapped = island(View);

    mountIslands([
      () => {
        // Simulate the lazy chunk: register the CE, then return the view.
        class FakeCE extends HTMLElement {}
        if (!customElements.get(tag)) customElements.define(tag, FakeCE);
        return Promise.resolve(Wrapped);
      },
    ]);

    for (let i = 0; i < 5; i++) await tick();

    expect(customElements.get(tag)).toBeDefined();
    // The CE was registered before we'd have called hydrate; the runtime
    // should have detected this AFTER awaiting and skipped hydrate.
    expect(hydrateCalls).toBe(0);
  });
});

describe('mountIslands() — lazy entries (ADR 0038 Phase 3)', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    if (host) host.remove();
    host = null;
  });

  it('awaits a thunk that returns a Promise of a view function', async () => {
    const count = state(0);
    const View = (): unknown => html`<p><!--[-->${() => count()}<!--]--></p>`;
    host = makeWrapper(1, 'load', '<p><!--[-->0<!--]--></p>');

    mountIslands([() => Promise.resolve(island(View))]);
    // Wait for the lazy resolution + queueMicrotask trigger.
    for (let i = 0; i < 5; i++) await tick();

    expect(host.textContent).toBe('0');
    count(11);
    await tick();
    expect(host.textContent).toBe('11');
  });

  it('unwraps a module namespace with a single named function export', async () => {
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');

    const onMount = vi.fn();
    mountIslands([() => Promise.resolve({ Counter: island(View) })], { onMount });
    for (let i = 0; i < 5; i++) await tick();

    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('prefers a `default` export when both default and named are present', async () => {
    let calls = 0;
    const Default = (): unknown => {
      calls++;
      return html`<span>x</span>`;
    };
    const Other = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');

    mountIslands([() => Promise.resolve({ default: island(Default), Other: island(Other) })]);
    for (let i = 0; i < 5; i++) await tick();

    expect(calls).toBeGreaterThan(0);
  });

  it('logs an error and skips when the thunk throws synchronously', async () => {
    host = makeWrapper(1, 'load', '<span>x</span>');

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountIslands([
      (): never => {
        throw new Error('thunk threw');
      },
    ]);
    for (let i = 0; i < 3; i++) await tick();

    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain('thunk threw');
    err.mockRestore();
  });

  it('treats a synchronously-returned module from a thunk as the resolved value', async () => {
    const count = state(0);
    const View = (): unknown => html`<p><!--[-->${() => count()}<!--]--></p>`;
    host = makeWrapper(1, 'load', '<p><!--[-->0<!--]--></p>');

    // The thunk returns the module synchronously (not via a Promise) —
    // simulating an already-resolved import or a precomputed factory.
    mountIslands([(): { default: typeof View } => ({ default: island(View) })]);
    for (let i = 0; i < 3; i++) await tick();

    expect(host.textContent).toBe('0');
    count(4);
    await tick();
    expect(host.textContent).toBe('4');
  });

  it('logs an error and skips when the thunk rejects', async () => {
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onMount = vi.fn();
    mountIslands([() => Promise.reject(new Error('chunk load failed')), island(View)], {
      onMount,
    });
    for (let i = 0; i < 5; i++) await tick();

    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain('island 1 import rejected');
    err.mockRestore();
  });

  it('warns when the resolved value is a non-object, non-function primitive', async () => {
    host = makeWrapper(1, 'load', '<span>x</span>');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountIslands([() => Promise.resolve(42)]);
    for (let i = 0; i < 5; i++) await tick();

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('expected a function or module');
    warn.mockRestore();
  });

  it('warns when the resolved module has no usable view', async () => {
    host = makeWrapper(1, 'load', '<span>x</span>');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountIslands([() => Promise.resolve({ notAFunction: 42 })]);
    for (let i = 0; i < 5; i++) await tick();

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('0 function exports');
    warn.mockRestore();
  });
});

describe('mountIslands() — idle trigger (ADR 0038 Phase 4)', () => {
  let host: HTMLElement | null = null;
  let originalRic: ((cb: () => void, opts?: object) => number) | undefined;

  beforeEach(() => {
    originalRic = (
      globalThis as { requestIdleCallback?: (cb: () => void, opts?: object) => number }
    ).requestIdleCallback;
  });
  afterEach(() => {
    if (originalRic) {
      (globalThis as Record<string, unknown>).requestIdleCallback = originalRic;
    } else {
      delete (globalThis as Record<string, unknown>).requestIdleCallback;
    }
    if (host) host.remove();
    host = null;
  });

  it('uses requestIdleCallback when present', async () => {
    const calls: (() => void)[] = [];
    (globalThis as Record<string, unknown>).requestIdleCallback = (cb: () => void) => {
      calls.push(cb);
      return 1;
    };

    const onMount = vi.fn();
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'idle', '<span>x</span>');

    mountIslands([island(View, { hydrate: 'idle' })], { onMount });
    await tick();

    expect(calls).toHaveLength(1);
    expect(onMount).not.toHaveBeenCalled();
    calls[0]();
    await tick();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('falls back to setTimeout when requestIdleCallback is missing', async () => {
    delete (globalThis as Record<string, unknown>).requestIdleCallback;
    const onMount = vi.fn();
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'idle', '<span>x</span>');

    mountIslands([island(View, { hydrate: 'idle' })], { onMount });
    await new Promise((r) => setTimeout(r, 10));
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

describe('mountIslands() — interact trigger (ADR 0038 Phase 4)', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    if (host) host.remove();
    host = null;
  });

  it('defers hydration until pointerdown', async () => {
    const count = state(0);
    const View = (): unknown => html`<p><!--[-->${() => count()}<!--]--></p>`;
    host = makeWrapper(1, 'interact', '<p><!--[-->0<!--]--></p>');

    mountIslands([island(View, { hydrate: 'interact' })]);
    await tick();

    // No interaction yet — write doesn't flow.
    count(2);
    await tick();
    expect(host.textContent).toBe('0');

    // Fire interaction at the wrapper level (the listener is on the
    // wrapper with capture: true).
    const wrapper = host.querySelector('purity-island')!;
    wrapper.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    for (let i = 0; i < 3; i++) await tick();
    expect(host.textContent).toBe('2');
  });

  it('also fires on focusin and keydown', async () => {
    const View = (): unknown => html`<span>x</span>`;
    const focusHost = makeWrapper(1, 'interact', '<span>x</span>');
    const keyHost = document.createElement('div');
    keyHost.innerHTML =
      '<purity-island data-pi-id="1" data-pi-trigger="interact" style="display:contents"><span>x</span></purity-island>';
    document.body.appendChild(keyHost);

    const onMountA = vi.fn();
    const onMountB = vi.fn();
    mountIslands([island(View, { hydrate: 'interact' })], { root: focusHost, onMount: onMountA });
    mountIslands([island(View, { hydrate: 'interact' })], { root: keyHost, onMount: onMountB });
    await tick();

    focusHost
      .querySelector('purity-island')!
      .dispatchEvent(new Event('focusin', { bubbles: true }));
    keyHost.querySelector('purity-island')!.dispatchEvent(new Event('keydown', { bubbles: true }));
    for (let i = 0; i < 3; i++) await tick();

    expect(onMountA).toHaveBeenCalledTimes(1);
    expect(onMountB).toHaveBeenCalledTimes(1);
    focusHost.remove();
    keyHost.remove();
    host = null;
  });

  it('hydrates exactly once even on rapid repeated events', async () => {
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'interact', '<span>x</span>');

    const onMount = vi.fn();
    mountIslands([island(View, { hydrate: 'interact' })], { onMount });
    await tick();

    const wrapper = host.querySelector('purity-island')!;
    wrapper.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    wrapper.dispatchEvent(new Event('focusin', { bubbles: true }));
    wrapper.dispatchEvent(new Event('keydown', { bubbles: true }));
    for (let i = 0; i < 3; i++) await tick();

    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

describe('mountIslands() — media trigger (ADR 0038 Phase 4)', () => {
  let host: HTMLElement | null = null;
  let originalMM: typeof matchMedia | undefined;
  const listeners: Record<string, Array<(e: MediaQueryListEvent) => void>> = {};

  beforeEach(() => {
    originalMM = (globalThis as { matchMedia?: typeof matchMedia }).matchMedia;
    for (const k in listeners) delete listeners[k];
  });
  afterEach(() => {
    if (originalMM) (globalThis as Record<string, unknown>).matchMedia = originalMM;
    else delete (globalThis as Record<string, unknown>).matchMedia;
    if (host) host.remove();
    host = null;
  });

  function installMatchMedia(matches: Record<string, boolean>): void {
    (globalThis as Record<string, unknown>).matchMedia = (query: string): MediaQueryList => {
      const matched = !!matches[query];
      return {
        matches: matched,
        media: query,
        onchange: null,
        addEventListener: (
          ev: string,
          cb: ((e: MediaQueryListEvent) => void) | EventListenerOrEventListenerObject,
        ): void => {
          if (ev !== 'change') return;
          (listeners[query] ??= []).push(cb as (e: MediaQueryListEvent) => void);
        },
        removeEventListener: (): void => {},
        dispatchEvent: (): boolean => true,
        addListener: (): void => {},
        removeListener: (): void => {},
      } as MediaQueryList;
    };
  }

  it('hydrates immediately when the query already matches', async () => {
    installMatchMedia({ '(min-width: 768px)': true });
    const onMount = vi.fn();
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'media:(min-width: 768px)', '<span>x</span>');

    mountIslands([island(View, { hydrate: 'media:(min-width: 768px)' })], { onMount });
    await tick();

    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('falls back to load trigger when matchMedia is missing', async () => {
    delete (globalThis as Record<string, unknown>).matchMedia;
    const onMount = vi.fn();
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'media:(min-width: 768px)', '<span>x</span>');

    mountIslands([island(View, { hydrate: 'media:(min-width: 768px)' })], { onMount });
    await tick();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back to load when matchMedia throws on the query', async () => {
    (globalThis as Record<string, unknown>).matchMedia = (): never => {
      throw new SyntaxError('bad media query');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onMount = vi.fn();
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'media:(bogus(', '<span>x</span>');

    mountIslands([island(View, { hydrate: 'media:(bogus(' })], { onMount });
    await tick();

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('invalid media query');
    expect(onMount).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('defers hydration until the query starts matching', async () => {
    installMatchMedia({ '(min-width: 768px)': false });
    const onMount = vi.fn();
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'media:(min-width: 768px)', '<span>x</span>');

    mountIslands([island(View, { hydrate: 'media:(min-width: 768px)' })], { onMount });
    await tick();
    expect(onMount).not.toHaveBeenCalled();

    const cbs = listeners['(min-width: 768px)'];
    expect(cbs).toHaveLength(1);
    cbs[0]({ matches: true } as MediaQueryListEvent);
    await tick();
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

describe('mountIslands() — visible fallback', () => {
  it('falls back to load when IntersectionObserver is missing', async () => {
    const originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    delete (globalThis as Record<string, unknown>).IntersectionObserver;
    try {
      const onMount = vi.fn();
      const View = (): unknown => html`<span>x</span>`;
      const host = makeWrapper(1, 'visible', '<span>x</span>');

      mountIslands([island(View, { hydrate: 'visible' })], { onMount });
      await tick();

      expect(onMount).toHaveBeenCalledTimes(1);
      host.remove();
    } finally {
      if (originalIO) {
        (globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
      }
    }
  });
});

describe('mountIslands() — visible trigger (IntersectionObserver)', () => {
  // jsdom doesn't ship IntersectionObserver; install a controllable stub.
  type Cb = (entries: { isIntersecting: boolean; target: Element }[], obs: any) => void;
  type Mocked = { observe: (el: Element) => void; disconnect: () => void; _cb: Cb };
  const observers: Mocked[] = [];
  let originalIO: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    observers.length = 0;
    originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    (globalThis as Record<string, unknown>).IntersectionObserver = function (this: any, cb: Cb) {
      const inst: Mocked = {
        _cb: cb,
        observe(_el: Element) {},
        disconnect() {},
      };
      observers.push(inst);
      return inst;
    } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    if (originalIO) {
      (globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
    } else {
      delete (globalThis as Record<string, unknown>).IntersectionObserver;
    }
    document.body.innerHTML = '';
  });

  it('defers hydration until the wrapper intersects', async () => {
    const count = state(0);
    const View = (): unknown => html`<p><!--[-->${() => count()}<!--]--></p>`;
    const host = makeWrapper(1, 'visible', '<p><!--[-->0<!--]--></p>');

    mountIslands([island(View, { hydrate: 'visible' })]);
    await tick();

    // Not yet hydrated — write doesn't flow.
    count(5);
    await tick();
    expect(host.textContent).toBe('0');

    // Fire intersection — hydration runs.
    const obs = observers[0];
    expect(obs).toBeDefined();
    obs._cb([{ isIntersecting: true, target: host.querySelector('purity-island')! }], obs);
    await tick();

    expect(host.textContent).toBe('5');
    count(9);
    await tick();
    expect(host.textContent).toBe('9');
  });
});

// ---------------------------------------------------------------------------
// audit-v2 regression tests
// ---------------------------------------------------------------------------

describe('mountIslands() — audit-v2: data-pi-trigger allow-list', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    if (host) host.remove();
    host = null;
  });

  it('rejects an empty media-query suffix (data-pi-trigger="media:")', async () => {
    // Pre-fix: `readTrigger` accepted any `media:`-prefixed string,
    // including the bare `media:` with no query — which would then
    // reach matchMedia('') in browsers that reject empty queries with
    // an exception (handled, but a needless error-path round trip).
    // Post-fix: `readTrigger` mirrors island.ts and rejects the bare
    // prefix at parse time, falling through to 'load'.
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'media:', '<span>x</span>');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onMount = vi.fn();
    mountIslands([island(View)], { onMount });
    await tick();

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('unknown data-pi-trigger');
    // Falls back to 'load', so onMount still fires.
    expect(onMount).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('mountIslands() — audit-v2: onMount throw isolation', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    if (host) host.remove();
    host = null;
  });

  it('logs an onMount throw as onMount-specific, not as a resolve failure', async () => {
    // Pre-fix: a throwing onMount escaped through the .then handler and
    // landed in the outer .catch, which logged
    // "failed to resolve island N" — a misleading false positive that
    // pointed at the chunk loader rather than the user callback. It
    // also masked the original onMount error stack.
    // Post-fix: onMount is invoked through a safeDone wrapper that
    // logs an onMount-specific message and swallows the throw.
    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountIslands([island(View)], {
      onMount: (): void => {
        throw new Error('onmount kaboom');
      },
    });
    for (let i = 0; i < 5; i++) await tick();

    expect(err).toHaveBeenCalled();
    const messages = err.mock.calls.map((c) => String(c[0]));
    // The new error logs say "onMount threw"; the pre-fix path would
    // have said "failed to resolve island 1".
    expect(messages.some((m) => m.includes('onMount threw for island 1'))).toBe(true);
    expect(messages.every((m) => !m.includes('failed to resolve island'))).toBe(true);
    err.mockRestore();
  });

  it('does not prevent sibling islands from hydrating when an earlier onMount throws', async () => {
    // Pre-fix: a sync throw from onMount would not directly cross
    // islands (they each have their own .then chain), but the
    // misleading error logged through the .catch made debugging hard.
    // This test pins the desired isolation: each island's hydration
    // is independent.
    const View = (): unknown => html`<span>x</span>`;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = [
      '<purity-island data-pi-id="1" data-pi-trigger="load" style="display:contents"><span>x</span></purity-island>',
      '<purity-island data-pi-id="2" data-pi-trigger="load" style="display:contents"><span>x</span></purity-island>',
    ].join('');
    document.body.appendChild(wrapper);
    host = wrapper;

    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onMount = vi.fn().mockImplementationOnce(() => {
      throw new Error('first island onMount throws');
    });
    mountIslands([island(View), island(View)], { onMount });
    for (let i = 0; i < 5; i++) await tick();

    // Both islands' onMount fire (the throwing one and the successful
    // one); the throw is contained.
    expect(onMount).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

describe('mountIslands() — audit-v2: unwrapModule prototype safety', () => {
  let host: HTMLElement | null = null;
  let pollutedKey: string | null = null;
  afterEach(() => {
    if (host) host.remove();
    host = null;
    if (pollutedKey) {
      delete (Object.prototype as Record<string, unknown>)[pollutedKey];
      pollutedKey = null;
    }
  });

  it('ignores inherited "default" from a polluted Object.prototype', async () => {
    // Pre-fix: `unwrapModule` checked `typeof mod.default === 'function'`
    // without guarding for inherited properties. A page that ran in a
    // prototype-polluted environment (e.g. an outdated dependency, or
    // a CTF-style attack) where `Object.prototype.default` is a function
    // could see the wrong view picked up for *every* plain-object
    // thunk return value.
    // Post-fix: the default lookup uses hasOwnProperty.
    pollutedKey = 'default';
    const evilDefault = vi.fn();
    (Object.prototype as Record<string, unknown>).default = evilDefault;

    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');

    const onMount = vi.fn();
    // Synchronously-returned object with a single own named export —
    // pre-fix would pick the polluted `default` over `Real`.
    mountIslands([(): Record<string, unknown> => ({ Real: island(View) })], { onMount });
    for (let i = 0; i < 5; i++) await tick();

    expect(evilDefault).not.toHaveBeenCalled();
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('ignores inherited function exports when counting named candidates', async () => {
    // Pre-fix: `for (const k in mod)` enumerated inherited enumerable
    // keys, so a polluted prototype with `Object.prototype.Other = fn`
    // could push the function-export count to 2 — making
    // unwrapModule refuse to pick the real export and skip hydration.
    pollutedKey = '__purityAuditInjected__';
    (Object.prototype as Record<string, unknown>)[pollutedKey] = (): void => {};

    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'load', '<span>x</span>');

    const onMount = vi.fn();
    mountIslands([() => Promise.resolve({ Real: island(View) })], { onMount });
    for (let i = 0; i < 5; i++) await tick();

    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

describe('mountIslands() — audit-v2: matchMedia/requestIdleCallback this-binding', () => {
  // Pre-fix: `const mm = globalThis.matchMedia; mm(query)` and the
  // analogous `ric(run, …)` invoke the cached builtin with
  // `this === undefined` in strict mode. Real browsers throw
  // "Illegal invocation" for `matchMedia`/`requestIdleCallback` when
  // detached from `window`. Post-fix: we use `.call(g, …)` so the
  // builtin sees the correct `this`. We simulate that contract here
  // with a stub that throws when called with the wrong receiver.

  let host: HTMLElement | null = null;
  let originalMM: typeof matchMedia | undefined;
  let originalRic: ((cb: () => void, opts?: object) => number) | undefined;

  beforeEach(() => {
    originalMM = (globalThis as { matchMedia?: typeof matchMedia }).matchMedia;
    originalRic = (
      globalThis as { requestIdleCallback?: (cb: () => void, opts?: object) => number }
    ).requestIdleCallback;
  });

  afterEach(() => {
    if (originalMM) (globalThis as Record<string, unknown>).matchMedia = originalMM;
    else delete (globalThis as Record<string, unknown>).matchMedia;
    if (originalRic) {
      (globalThis as Record<string, unknown>).requestIdleCallback = originalRic;
    } else {
      delete (globalThis as Record<string, unknown>).requestIdleCallback;
    }
    if (host) host.remove();
    host = null;
  });

  it('invokes matchMedia with `this === globalThis` (no Illegal invocation)', async () => {
    const g = globalThis as Record<string, unknown>;
    // Browser-faithful stub: throws if invoked with the wrong receiver.
    function strictMatchMedia(this: unknown, query: string): MediaQueryList {
      if (this !== g) {
        throw new TypeError('Illegal invocation');
      }
      return {
        matches: true,
        media: query,
        onchange: null,
        addEventListener: (): void => {},
        removeEventListener: (): void => {},
        dispatchEvent: (): boolean => true,
        addListener: (): void => {},
        removeListener: (): void => {},
      } as MediaQueryList;
    }
    g.matchMedia = strictMatchMedia;

    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'media:(min-width: 1px)', '<span>x</span>');

    const onMount = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountIslands([island(View, { hydrate: 'media:(min-width: 1px)' })], { onMount });
    await tick();

    // No "Illegal invocation" warn, onMount fires immediately (matches=true).
    expect(warn).not.toHaveBeenCalled();
    expect(onMount).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('invokes requestIdleCallback with `this === globalThis`', async () => {
    const g = globalThis as Record<string, unknown>;
    let receiverOK = false;
    function strictRic(this: unknown, cb: () => void): number {
      if (this !== g) {
        throw new TypeError('Illegal invocation');
      }
      receiverOK = true;
      // Run synchronously for test determinism.
      cb();
      return 1;
    }
    g.requestIdleCallback = strictRic;

    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'idle', '<span>x</span>');

    const onMount = vi.fn();
    mountIslands([island(View, { hydrate: 'idle' })], { onMount });
    await tick();

    expect(receiverOK).toBe(true);
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Bug #5 — IntersectionObserver leak on detached island wrappers
// ---------------------------------------------------------------------------
describe('mountIslands() — audit-v2 Bug #5: detached wrapper unobserves IO', () => {
  // Pre-fix: visible-triggered islands installed an IntersectionObserver
  // on the wrapper but never detected wrapper detachment. If the parent
  // removed the wrapper before it scrolled into view, the IO target
  // kept the element alive and the observer stayed armed forever — a
  // leak. Post-fix: a MutationObserver on the parent unobserves the IO
  // and disconnects both observers when the wrapper goes missing.

  type Cb = (entries: { isIntersecting: boolean; target: Element }[], obs: unknown) => void;
  type SpyIO = {
    _cb: Cb;
    observed: Element[];
    unobserved: Element[];
    disconnected: number;
    observe(el: Element): void;
    unobserve(el: Element): void;
    disconnect(): void;
  };
  const ios: SpyIO[] = [];
  let originalIO: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    ios.length = 0;
    originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    (globalThis as Record<string, unknown>).IntersectionObserver = function (
      this: unknown,
      cb: Cb,
    ): SpyIO {
      const inst: SpyIO = {
        _cb: cb,
        observed: [],
        unobserved: [],
        disconnected: 0,
        observe(el) {
          this.observed.push(el);
        },
        unobserve(el) {
          this.unobserved.push(el);
        },
        disconnect() {
          this.disconnected++;
        },
      };
      ios.push(inst);
      return inst;
    } as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    if (originalIO) {
      (globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
    } else {
      delete (globalThis as Record<string, unknown>).IntersectionObserver;
    }
    document.body.innerHTML = '';
  });

  it('unobserves + disconnects the IO when the wrapper is removed before intersecting', async () => {
    const View = (): unknown => html`<span>x</span>`;
    const host = makeWrapper(1, 'visible', '<span>x</span>');
    mountIslands([island(View, { hydrate: 'visible' })]);
    await tick();

    const io = ios[0];
    expect(io).toBeDefined();
    const wrapper = host.querySelector('purity-island')!;
    expect(io.observed).toContain(wrapper);
    expect(io.disconnected).toBe(0);

    // Detach the wrapper from its parent before any intersection fires.
    wrapper.remove();
    // jsdom MutationObservers fire on a microtask — flush.
    for (let i = 0; i < 5; i++) await tick();

    // The fix: unobserve was called for the wrapper AND the observer
    // was disconnected (no more armed reference).
    expect(io.unobserved).toContain(wrapper);
    expect(io.disconnected).toBeGreaterThanOrEqual(1);
    host.remove();
  });

  it('does not double-fire when the wrapper detaches AFTER it has already intersected', async () => {
    // Make sure the detach-watcher's re-entrancy guard cooperates with
    // the IO-callback path: an intersection that already disposed the
    // observers must not be re-disposed when the wrapper is later
    // removed (and the cleanup must not double-call run()).
    const onMount = vi.fn();
    const View = (): unknown => html`<span>x</span>`;
    const host = makeWrapper(1, 'visible', '<span>x</span>');
    mountIslands([island(View, { hydrate: 'visible' })], { onMount });
    await tick();

    const io = ios[0];
    const wrapper = host.querySelector('purity-island')!;
    io._cb([{ isIntersecting: true, target: wrapper }], io);
    for (let i = 0; i < 3; i++) await tick();
    expect(onMount).toHaveBeenCalledTimes(1);

    // Now detach — the MutationObserver fires, but the guard prevents
    // a second tear-down round and (critically) does not re-run().
    wrapper.remove();
    for (let i = 0; i < 5; i++) await tick();
    expect(onMount).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe('mountIslands() — audit-v2: media re-entrant guard', () => {
  let host: HTMLElement | null = null;
  let originalMM: typeof matchMedia | undefined;
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];

  beforeEach(() => {
    originalMM = (globalThis as { matchMedia?: typeof matchMedia }).matchMedia;
    listeners.length = 0;
  });
  afterEach(() => {
    if (originalMM) (globalThis as Record<string, unknown>).matchMedia = originalMM;
    else delete (globalThis as Record<string, unknown>).matchMedia;
    if (host) host.remove();
    host = null;
  });

  it('only hydrates once even if `change` fires twice in the same tick', async () => {
    // Pre-fix: the media handler removed itself on first match but had
    // no `fired` guard, so two synchronous change dispatches in the
    // same task — before `removeEventListener` was honored — could
    // both reach `run()`, double-arming hydration.
    let removed = false;
    (globalThis as Record<string, unknown>).matchMedia = (query: string): MediaQueryList =>
      ({
        media: query,
        matches: false,
        onchange: null,
        addEventListener: (
          ev: string,
          cb: ((e: MediaQueryListEvent) => void) | EventListenerOrEventListenerObject,
        ): void => {
          if (ev === 'change') listeners.push(cb as (e: MediaQueryListEvent) => void);
        },
        removeEventListener: (): void => {
          // Simulate browsers that defer the removal until after the
          // current event-dispatch loop — leaves the listener live for
          // the duration of the synchronous burst below.
          removed = true;
        },
        dispatchEvent: (): boolean => true,
        addListener: (): void => {},
        removeListener: (): void => {},
      }) as MediaQueryList;

    const View = (): unknown => html`<span>x</span>`;
    host = makeWrapper(1, 'media:(min-width: 768px)', '<span>x</span>');

    const onMount = vi.fn();
    mountIslands([island(View, { hydrate: 'media:(min-width: 768px)' })], { onMount });
    await tick();

    expect(listeners).toHaveLength(1);
    // Burst: two synchronous matches, then a no-op non-match.
    listeners[0]({ matches: true } as MediaQueryListEvent);
    listeners[0]({ matches: true } as MediaQueryListEvent);
    listeners[0]({ matches: false } as MediaQueryListEvent);
    for (let i = 0; i < 5; i++) await tick();

    expect(removed).toBe(true);
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
