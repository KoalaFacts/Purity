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
