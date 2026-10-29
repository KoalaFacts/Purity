// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { onDispose, onError } from '../src/component.ts';
import { island } from '../src/island.ts';
import { mountIslands } from '../src/island-mount.ts';
import { state, watch } from '../src/signals.ts';
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
    const View = () => {
      // Corrected handwritten hydration can safely adopt the existing node.
      // It need not invoke JIT's documented mismatch/rebuild fallback.
      watch(() => {
        serverParagraph.childNodes[1]!.textContent = String(count());
      });
      return serverParagraph;
    };
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

it('retries a handled island render error instead of committing an unhydrated wrapper', async () => {
  const host = document.createElement('div');
  host.innerHTML =
    '<purity-island data-pi-id="1" data-pi-trigger="load"><p>server</p></purity-island>';
  document.body.append(host);
  const wrapper = host.querySelector('purity-island')!;
  const serverParagraph = wrapper.querySelector('p')!;
  const onMount = vi.fn();
  let attempts = 0;
  let handled = 0;
  const View = () => {
    if (++attempts === 1) {
      onError(() => handled++);
      throw new Error('handled initial view failure');
    }
    return serverParagraph;
  };

  mountIslands([island(View)], { root: host, onMount });
  for (let i = 0; i < 5; i++) await tick();
  expect(handled).toBe(1);
  expect(attempts).toBe(1);
  expect(wrapper.querySelector('p')).toBe(serverParagraph);

  mountIslands([island(View)], { root: host, onMount });
  for (let i = 0; i < 5; i++) await tick();
  expect(attempts).toBe(2);
  expect(onMount).toHaveBeenCalledTimes(2);
  expect(wrapper.querySelector('p')).toBe(serverParagraph);
});

it('retries an empty island after onError consumes the first mount failure', async () => {
  const host = document.createElement('div');
  host.innerHTML = '<purity-island data-pi-id="1" data-pi-trigger="load"></purity-island>';
  document.body.append(host);
  const wrapper = host.querySelector('purity-island')!;
  const onMount = vi.fn();
  let attempts = 0;
  let handled = 0;
  let disposed = 0;
  const View = () => {
    attempts++;
    if (attempts === 1) {
      onDispose(() => disposed++);
      onError(() => handled++);
      throw new Error('handled empty-root failure');
    }
    const paragraph = document.createElement('p');
    paragraph.textContent = 'recovered';
    return paragraph;
  };

  mountIslands([island(View)], { root: host, onMount });
  for (let i = 0; i < 5; i++) await tick();
  expect({ attempts, handled, disposed }).toEqual({ attempts: 1, handled: 1, disposed: 1 });
  expect(wrapper.childNodes).toHaveLength(0);

  mountIslands([island(View)], { root: host, onMount });
  for (let i = 0; i < 5; i++) await tick();
  expect(attempts).toBe(2);
  expect(onMount).toHaveBeenCalledTimes(2);
  expect(wrapper.textContent).toBe('recovered');

  mountIslands([island(View)], { root: host, onMount });
  for (let i = 0; i < 5; i++) await tick();
  expect(attempts).toBe(2);
  expect(disposed).toBe(1);
});
