// @vitest-environment jsdom
// End-to-end parity test for marker-walking hydration.
//
// Renders a component to a string via `renderToString`, parses it into the
// DOM, then hydrates with the same component using the client-side `html`
// tag. Asserts (a) the SSR-rendered nodes survive hydration with their
// identity intact (no rebuild) and (b) reactive bindings attach to those
// surviving nodes.
//
// User code in real apps shares `html` across server and client (the Vite
// plugin AOT-compiles per target). Here we simulate that by parameterizing
// the user's component on the `html` tag — the test then drives it with
// the SSR variant for renderToString and the core variant for hydrate.

import { html as clientHtml, hydrate, state } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderToString } from '../src/index.ts';

type AnyHtml = (strings: TemplateStringsArray, ...values: unknown[]) => unknown;

async function ssrThenHydrate(
  Component: (htmlTag: AnyHtml, deps: unknown) => unknown,
  deps: unknown,
): Promise<{ host: HTMLElement; firstChildAfterSSR: ChildNode | null }> {
  const ssrOutput = await renderToString(() => Component(ssrHtml as AnyHtml, deps));
  const host = document.createElement('div');
  host.innerHTML = ssrOutput;
  document.body.appendChild(host);
  const firstChildAfterSSR = host.firstChild;
  hydrate(host, () => Component(clientHtml as AnyHtml, deps) as Node);
  return { host, firstChildAfterSSR };
}

describe('SSR → hydrate parity (marker-walking)', () => {
  it('preserves SSR root nodes and binds reactive text', async () => {
    const count = state(0);
    const App = (h: AnyHtml, _deps: unknown) => h`<div><p>Count: ${() => count()}</p></div>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    // The outer <div> survives — same node reference.
    expect(host.firstChild).toBe(firstChildAfterSSR);
    expect(host.textContent).toBe('Count: 0');

    count(42);
    await Promise.resolve();
    expect(host.textContent).toBe('Count: 42');
  });

  it('preserves SSR DOM through nested templates', async () => {
    const name = state('Ada');
    const App = (h: AnyHtml, _deps: unknown) =>
      h`<section><header>${h`<h1>${() => name()}</h1>`}</header></section>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    const ssrSection = firstChildAfterSSR as HTMLElement;
    const ssrHeader = ssrSection.querySelector('header');
    const ssrH1 = ssrSection.querySelector('h1');
    expect(ssrH1).not.toBeNull();
    expect(host.textContent).toBe('Ada');

    name('Bea');
    await Promise.resolve();
    // Same section + header + h1 survive.
    expect(host.firstChild).toBe(ssrSection);
    expect(ssrSection.querySelector('header')).toBe(ssrHeader);
    expect(ssrSection.querySelector('h1')).toBe(ssrH1);
    expect(host.textContent).toBe('Bea');
  });

  it('binds events to existing SSR elements', async () => {
    let clicks = 0;
    const App = (h: AnyHtml, _deps: unknown) => h`<button @click=${() => clicks++}>Click</button>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    const btn = firstChildAfterSSR as HTMLButtonElement;
    expect(host.firstChild).toBe(btn);
    btn.click();
    btn.click();
    expect(clicks).toBe(2);
  });

  it('re-applies dynamic attributes reactively without replacing the element', async () => {
    const cls = state('warn');
    const App = (h: AnyHtml, _deps: unknown) => h`<p class=${() => cls()}>x</p>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);

    const p = firstChildAfterSSR as HTMLElement;
    expect(p.getAttribute('class')).toBe('warn');

    cls('ok');
    await Promise.resolve();
    expect(host.firstChild).toBe(p);
    expect(p.getAttribute('class')).toBe('ok');
  });

  it('handles adjacent expression slots (comment-placeholder path)', async () => {
    const a = state('A');
    const b = state('B');
    const App = (h: AnyHtml, _deps: unknown) => h`<p>${() => a()}-${() => b()}</p>`;

    const { host, firstChildAfterSSR } = await ssrThenHydrate(App, null);
    const p = firstChildAfterSSR as HTMLElement;

    expect(host.textContent).toBe('A-B');
    a('X');
    b('Y');
    await Promise.resolve();
    expect(host.firstChild).toBe(p);
    expect(host.textContent).toBe('X-Y');
  });
});
