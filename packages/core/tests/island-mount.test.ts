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
