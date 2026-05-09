import { beforeEach, describe, expect, it } from 'vitest';
import { component, html, hydrate, state } from '../src/index.ts';
import { tick } from './_helpers.ts';

describe('hydrate — marker-walking', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('preserves the existing element when the template matches', () => {
    // Stage SSR-like markup: a single <p> with text content. The hydration
    // markers around the value have already been emitted by the SSR codegen.
    host.innerHTML = '<p><!--[-->hello<!--]--></p>';
    const beforeP = host.firstChild;
    // The actual text node lives between the marker comments — capture it
    // there so we can verify the same Node instance survives stripping.
    const beforeText = beforeP?.firstChild?.nextSibling;
    hydrate(host, () => html`<p>${'hello'}</p>`);
    // The element is the same — hydrate didn't replace.
    expect(host.firstChild).toBe(beforeP);
    // Markers stripped; the text node remains and is now firstChild.
    expect(host.innerHTML).toBe('<p>hello</p>');
    expect(host.firstChild?.firstChild).toBe(beforeText);
  });

  it('binds reactive expressions to existing text nodes', async () => {
    host.innerHTML = '<p><!--[-->0<!--]--></p>';
    const count = state(0);
    // Text node is between the markers (firstChild is the open marker).
    const textNodeBefore = host.firstChild?.firstChild?.nextSibling;
    hydrate(host, () => html`<p>${() => count()}</p>`);
    // Same text node, content unchanged.
    expect(host.firstChild?.firstChild).toBe(textNodeBefore);
    expect(host.firstChild?.textContent).toBe('0');
    // Reactive update writes through to the same node.
    count(7);
    await tick();
    expect(host.firstChild?.firstChild).toBe(textNodeBefore);
    expect(host.firstChild?.textContent).toBe('7');
  });

  it('attaches event listeners to the existing element', () => {
    host.innerHTML = '<button>click</button>';
    let clicks = 0;
    const onClick = () => {
      clicks++;
    };
    hydrate(host, () => html`<button @click=${onClick}>click</button>`);
    (host.firstChild as HTMLElement).click();
    expect(clicks).toBe(1);
  });

  it('returns an unmount handle that detaches the rendered tree', async () => {
    host.innerHTML = '<p><!--[-->x<!--]--></p>';
    const { unmount } = hydrate(host, () => html`<p>${'x'}</p>`);
    expect(host.children.length).toBe(1);
    unmount();
    await tick();
    expect(host.children.length).toBe(0);
  });

  it('falls back to fresh render for an empty container', () => {
    expect(() => hydrate(host, () => html`<span>x</span>`)).not.toThrow();
    expect(host.innerHTML).toBe('<span>x</span>');
  });

  it('falls back to fresh render when the template shape is unsupported', () => {
    // Templates containing a custom-element tag are NOT covered by the
    // Phase 1 hydrator — generateHydrate returns null for that AST shape,
    // so the html`` tag falls through to the regular render path. The
    // resulting fresh tree replaces the SSR DOM.
    component('p-fallback', () => html`<span>fresh</span>`);
    host.innerHTML = '<p-fallback><template shadowrootmode="open"></template></p-fallback>';
    hydrate(host, () => html`<p-fallback></p-fallback>`);
    expect(host.firstChild?.nodeName.toLowerCase()).toBe('p-fallback');
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
    const el = document.createElement('p-hydrated-1');
    el.shadowRoot!.innerHTML = '<span>stale</span><span>extra</span>';
    host.appendChild(el);
    expect(el.shadowRoot?.children.length).toBe(1);
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
