// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { html } from '../src/compiler/compile.ts';
import { island } from '../src/island.ts';
import { mountIslands } from '../src/island-mount.ts';
import { state } from '../src/signals.ts';
import { tick } from './_helpers.ts';

afterEach(() => {
  document.body.replaceChildren();
});

it('retries an island after failed hydrate adoption without replacing SSR DOM', async () => {
  const host = document.createElement('div');
  host.innerHTML =
    '<purity-island data-pi-id="1" data-pi-trigger="load"><p><!--[-->0<!--]--></p></purity-island>';
  document.body.append(host);
  const wrapper = host.querySelector('purity-island')!;
  const serverParagraph = wrapper.querySelector('p')!;
  const onMount = vi.fn();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    // This detached client-only tree is intentionally invalid for adoption.
    // hydrate() rejects it after preparing the SSR root; no claim may stick.
    mountIslands([island(() => document.createElement('p'))], { root: host, onMount });
    for (let i = 0; i < 5; i++) await tick();
    expect(error.mock.calls.some(([message]) => String(message).includes('hydrate() threw'))).toBe(
      true,
    );
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(wrapper.querySelector('p')).toBe(serverParagraph);
    expect(serverParagraph.textContent).toBe('0');

    const count = state(0);
    const View = () => html`<p><!--[-->${() => count()}<!--]--></p>`;
    mountIslands([island(View)], { root: host, onMount });
    for (let i = 0; i < 5; i++) await tick();
    expect(onMount).toHaveBeenCalledTimes(2);
    expect(wrapper.querySelector('p')).toBe(serverParagraph);
    count(7);
    await tick();
    expect(serverParagraph.textContent).toBe('7');

    // Successful hydration remains idempotent, including future scans.
    mountIslands([island(View)], { root: host, onMount });
    await tick();
    expect(onMount).toHaveBeenCalledTimes(2);
  } finally {
    error.mockRestore();
  }
});
