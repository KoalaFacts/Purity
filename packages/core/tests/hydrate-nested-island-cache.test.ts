// @vitest-environment jsdom
import { afterEach, expect, it } from 'vite-plus/test';
import { hydrate } from '../src/hydrate.ts';
import { hydratePendingCustomElements } from '../src/compiler/hydrate-elements.ts';
import { clearHydrationCache, consumeHydrationValue } from '../src/ssr/hydration-cache.ts';

afterEach(() => {
  document.body.replaceChildren();
  clearHydrationCache();
});

it('keeps a deferred nested island’s cache scripts for that island, not its parent root', () => {
  const host = document.createElement('main');
  const parentView = document.createElement('p');
  parentView.textContent = 'shell';
  const parentScript = document.createElement('script');
  parentScript.id = '__purity_resources__';
  parentScript.type = 'application/json';
  parentScript.textContent = '{"keyed":{"parent":"shell-value"}}';

  const island = document.createElement('purity-island');
  island.setAttribute('data-pi-id', '1');
  island.setAttribute('data-pi-trigger', 'interact');
  const islandView = document.createElement('p');
  islandView.textContent = 'island';
  const islandScript = document.createElement('script');
  islandScript.id = '__purity_resources__';
  islandScript.type = 'application/json';
  islandScript.textContent = '{"keyed":{"child":"island-value"}}';
  island.append(islandView, islandScript);
  host.append(parentView, parentScript, island);
  document.body.append(host);

  const shell = hydrate(host, () => parentView);
  expect(consumeHydrationValue('parent')).toBe('shell-value');
  expect(consumeHydrationValue('child')).toBeUndefined();
  expect(parentScript.isConnected).toBe(false);
  expect(islandScript.parentNode).toBe(island);
  expect(islandView.isConnected).toBe(true);

  // The island may hydrate much later, when its own trigger fires.
  const child = hydrate(island, () => islandView);
  expect(consumeHydrationValue('child')).toBe('island-value');
  expect(consumeHydrationValue('parent')).toBeUndefined();
  expect(islandScript.isConnected).toBe(false);
  expect(islandView.parentNode).toBe(island);

  child.unmount();
  shell.unmount();
  expect(islandView.isConnected).toBe(false);
});

it('defers nested island Custom Element hydration until its own root is adopted', () => {
  const host = document.createElement('main');
  const parent = document.createElement('x-shell-hydrate');
  const island = document.createElement('purity-island');
  island.setAttribute('data-pi-id', '1');
  island.setAttribute('data-pi-trigger', 'interact');
  const child = document.createElement('x-lazy-hydrate');
  let shellCalls = 0;
  let islandCalls = 0;
  (parent as Element & { _hydrateSSR?: () => void })._hydrateSSR = () => shellCalls++;
  (child as Element & { _hydrateSSR?: () => void })._hydrateSSR = () => islandCalls++;
  island.appendChild(child);
  host.append(parent, island);
  document.body.appendChild(host);

  const shell = hydrate(host, () => parent);
  expect(shellCalls).toBe(1);
  expect(islandCalls).toBe(0);
  expect(child.parentNode).toBe(island);
  const nested = hydrate(island, () => child);
  expect(shellCalls).toBe(1);
  expect(islandCalls).toBe(1);
  nested.unmount();
  shell.unmount();
});

it('does not traverse a deferred island inside a Custom Element shadow root', () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const parent = document.createElement('x-shadow-hydrate');
  const island = document.createElement('purity-island');
  const child = document.createElement('x-shadow-lazy-hydrate');
  let parentCalls = 0;
  let nestedCalls = 0;
  (parent as Element & { _hydrateSSR?: () => void })._hydrateSSR = () => parentCalls++;
  (child as Element & { _hydrateSSR?: () => void })._hydrateSSR = () => nestedCalls++;
  island.appendChild(child);
  shadow.append(parent, island);
  document.body.appendChild(host);

  hydratePendingCustomElements(shadow);
  expect(parentCalls).toBe(1);
  expect(nestedCalls).toBe(0);
  hydratePendingCustomElements(island);
  expect(nestedCalls).toBe(1);
});
