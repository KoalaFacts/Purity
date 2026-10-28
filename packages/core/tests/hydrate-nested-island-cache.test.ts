// @vitest-environment jsdom
import { afterEach, expect, it } from 'vite-plus/test';
import { hydrate } from '../src/hydrate.ts';
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
