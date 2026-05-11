import { beforeEach, describe, expect, it } from 'vitest';
import { component, html, hydrate, state } from '../src/index.ts';
import { tick } from './_helpers.ts';

describe('hydrate (marker-walking, non-lossy)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('preserves the existing SSR DOM nodes (identity), no rebuild', () => {
    host.innerHTML = '<p>fresh</p>';
    const ssrP = host.firstChild;
    hydrate(host, () => html`<p>fresh</p>`);
    // Same node reference — non-lossy hydration didn't replace it.
    expect(host.firstChild).toBe(ssrP);
    expect(host.innerHTML).toBe('<p>fresh</p>');
  });

  it('binds reactive expressions to the existing SSR text node', async () => {
    host.innerHTML = '<p><!--[-->0<!--]--></p>';
    const ssrP = host.firstChild;
    const ssrText = ssrP?.childNodes[1]; // the text "0" between markers
    const count = state(0);
    hydrate(host, () => html`<p>${() => count()}</p>`);
    // SSR <p> is still in place.
    expect(host.firstChild).toBe(ssrP);
    expect(host.textContent).toBe('0');
    // Reactive write updates the same text node we walked into.
    count(7);
    await tick();
    expect(host.textContent).toBe('7');
    expect(ssrText?.nodeValue).toBe('7');
  });

  it('inflates nested templates against the slot subtree', async () => {
    host.innerHTML = '<div><!--[--><span><!--[-->Ada<!--]--></span><!--]--></div>';
    const ssrDiv = host.firstChild;
    const ssrSpan = ssrDiv?.childNodes[1];
    const name = state('Ada');
    hydrate(host, () => html`<div>${html`<span>${() => name()}</span>`}</div>`);
    // Both outer div and inner span survive intact.
    expect(host.firstChild).toBe(ssrDiv);
    expect(ssrDiv?.childNodes[1]).toBe(ssrSpan);
    expect(host.textContent).toBe('Ada');
    name('Bea');
    await tick();
    expect(host.textContent).toBe('Bea');
  });

  it('attaches event listeners to the existing SSR element', () => {
    host.innerHTML = '<button>Click</button>';
    const ssrBtn = host.firstChild as HTMLButtonElement;
    let clicks = 0;
    hydrate(host, () => html`<button @click=${() => clicks++}>Click</button>`);
    expect(host.firstChild).toBe(ssrBtn);
    ssrBtn.click();
    expect(clicks).toBe(1);
  });

  it('binds dynamic attributes reactively against existing elements', async () => {
    host.innerHTML = '<p class="warn">x</p>';
    const ssrP = host.firstChild as HTMLElement;
    const cls = state('warn');
    hydrate(host, () => html`<p class=${() => cls()}>x</p>`);
    expect(host.firstChild).toBe(ssrP);
    cls('ok');
    await tick();
    expect(ssrP.getAttribute('class')).toBe('ok');
  });

  it('binds DOM properties (which SSR cannot set) on the existing element', () => {
    host.innerHTML = '<input>';
    const ssrInput = host.firstChild as HTMLInputElement;
    hydrate(host, () => html`<input .value=${'typed'} />`);
    expect(host.firstChild).toBe(ssrInput);
    expect(ssrInput.value).toBe('typed');
  });

  it('falls back to mount() when the container is empty', () => {
    expect(host.firstChild).toBeNull();
    hydrate(host, () => html`<span>x</span>`);
    expect(host.innerHTML).toBe('<span>x</span>');
  });

  it('returns an unmount handle that removes the SSR-preserved nodes', async () => {
    host.innerHTML = '<p><!--[-->A<!--]--></p>';
    const text = state('A');
    const { unmount } = hydrate(host, () => html`<p>${() => text()}</p>`);
    expect(host.textContent).toBe('A');
    unmount();
    await tick();
    expect(host.children.length).toBe(0);
  });

  it('handles two-pass reactive update without dangling SSR text', async () => {
    host.innerHTML = '<p><!--[-->initial<!--]--></p>';
    const v = state('initial');
    hydrate(host, () => html`<p>${() => v()}</p>`);
    expect(host.textContent).toBe('initial');
    v('next');
    await tick();
    expect(host.textContent).toBe('next');
    v('again');
    await tick();
    expect(host.textContent).toBe('again');
  });
});

describe('hydrate + custom elements (DSD reuse)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('preserves DSD shadow content non-lossily when SSR markers are present', () => {
    component('p-hydrated-1', () => html`<span>${'fresh'}</span>`);
    // Stage what DSD parsing would produce: a span with marker-wrapped content.
    const el = document.createElement('p-hydrated-1');
    el.shadowRoot!.innerHTML = '<span><!--[-->fresh<!--]--></span>';
    const ssrSpan = el.shadowRoot!.firstChild;
    host.appendChild(el); // triggers connectedCallback under hydration mode
    // Same span — connectedCallback hydrated against the existing shadow.
    expect(el.shadowRoot?.firstChild).toBe(ssrSpan);
    expect(el.shadowRoot?.querySelector('span')?.textContent).toBe('fresh');
  });

  it('does not throw when constructor encounters a pre-attached shadow', () => {
    component('p-hydrated-2', () => html`<span>x</span>`);
    expect(() => {
      const el = document.createElement('p-hydrated-2');
      host.appendChild(el);
      void el;
    }).not.toThrow();
  });
});
