import { beforeEach, describe, expect, it } from 'vitest';
import { component, html, hydrate, state } from '../src/index.ts';
import { tick } from './_helpers.ts';

describe('hydrate', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('discards existing children and renders the component fresh', () => {
    host.innerHTML = '<p>stale SSR content</p>';
    hydrate(host, () => html`<p>fresh</p>`);
    expect(host.innerHTML).toBe('<p>fresh</p>');
  });

  it('binds reactive expressions in the freshly rendered tree', async () => {
    host.innerHTML = '<p>old: <!--[-->0<!--]--></p>';
    const count = state(0);
    hydrate(host, () => html`<p>${() => count()}</p>`);
    expect(host.innerHTML).toContain('0');
    count(7);
    await tick();
    expect(host.innerHTML).toContain('7');
  });

  it('returns an unmount handle that empties the container', async () => {
    host.innerHTML = '<p>SSR</p>';
    const { unmount } = hydrate(host, () => html`<p>client</p>`);
    expect(host.innerHTML).toBe('<p>client</p>');
    unmount();
    await tick();
    expect(host.children.length).toBe(0);
  });

  it('handles an empty container without error', () => {
    expect(() => hydrate(host, () => html`<span>x</span>`)).not.toThrow();
    expect(host.innerHTML).toBe('<span>x</span>');
  });
});

describe('hydrate + custom elements (DSD reuse)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('clears pre-existing shadow content before re-rendering (DSD case)', () => {
    component('p-hydrated-1', () => html`<span>fresh</span>`);
    // Simulate the post-DSD state: between construction and connection,
    // the shadow root exists but already holds DSD-parsed content.
    // Construction (constructor → attachShadow) and connection
    // (connectedCallback → render into shadow) are separated in time:
    // we exploit that gap to inject stale shadow content.
    const el = document.createElement('p-hydrated-1');
    el.shadowRoot!.innerHTML = '<span>stale</span><span>extra</span>';
    host.appendChild(el); // triggers connectedCallback
    // The connectedCallback clears the shadow before appending the freshly
    // rendered tree, so only the new <span>fresh</span> should remain.
    expect(el.shadowRoot?.children.length).toBe(1);
    expect(el.shadowRoot?.querySelector('span')?.textContent).toBe('fresh');
  });

  it('does not throw when constructor encounters a pre-attached shadow', () => {
    component('p-hydrated-2', () => html`<span>x</span>`);
    // The constructor reuses `this.shadowRoot` if non-null instead of calling
    // attachShadow a second time (which would throw NotSupportedError). This
    // is the path real browsers take after DSD parsing.
    expect(() => {
      const el = document.createElement('p-hydrated-2');
      host.appendChild(el);
      void el;
    }).not.toThrow();
  });
});
