// @vitest-environment jsdom
import { afterEach, expect, it } from 'vite-plus/test';
import { hydrate } from '../src/hydrate.ts';
import { clearHydrationCache, consumeHydrationValue } from '../src/ssr/hydration-cache.ts';

afterEach(() => {
  document.body.replaceChildren();
  clearHydrationCache();
});

it('stops adjacent streaming cache discovery at an unrelated script', () => {
  const root = document.createElement('main');
  const p = document.createElement('p');
  p.textContent = 'root';
  root.appendChild(p);

  const unrelated = document.createElement('script');
  unrelated.type = 'application/json';
  unrelated.id = 'other-script';
  unrelated.textContent = '{}';

  const foreignCache = document.createElement('script');
  foreignCache.type = 'application/json';
  foreignCache.id = '__purity_resources_1__';
  foreignCache.textContent = '{"keyed":{"other":"foreign-value"}}';
  document.body.append(root, unrelated, foreignCache);

  let borrowed: unknown;
  const owner = hydrate(root, () => {
    borrowed = consumeHydrationValue('other');
    return p;
  });
  try {
    expect(borrowed).toBeUndefined();
    expect(unrelated.nextElementSibling).toBe(foreignCache);
    expect(unrelated.isConnected).toBe(true);
    expect(foreignCache.isConnected).toBe(true);
    expect(root.firstChild).toBe(p);
  } finally {
    owner.unmount();
  }
});

it('does not consume an executable script with a resource-shaped id', () => {
  const root = document.createElement('main');
  const p = document.createElement('p');
  p.textContent = 'root';
  const executable = document.createElement('script');
  executable.type = 'text/javascript';
  executable.id = '__purity_resources__';
  // Executable JavaScript must stay valid: jsdom actually runs connected scripts.
  executable.textContent = 'void 0;';
  root.append(p, executable);
  document.body.append(root);

  let borrowed: unknown;
  const owner = hydrate(root, () => {
    borrowed = consumeHydrationValue('wrong');
    return p;
  });
  try {
    expect(borrowed).toBeUndefined();
    expect(executable.parentNode).toBe(root);
    expect(root.firstChild).toBe(p);
  } finally {
    owner.unmount();
  }
});

it('does not cross a non-JSON script even if its id resembles streaming cache', () => {
  const root = document.createElement('main');
  const p = document.createElement('p');
  root.append(p);
  const unrelated = document.createElement('script');
  unrelated.type = 'text/javascript';
  unrelated.id = '__purity_resources_external';
  unrelated.textContent = 'void 0;';
  const foreignCache = document.createElement('script');
  foreignCache.type = 'application/json';
  foreignCache.id = '__purity_resources_2__';
  foreignCache.textContent = '{"keyed":{"foreign":"value"}}';
  document.body.append(root, unrelated, foreignCache);

  let borrowed: unknown;
  const owner = hydrate(root, () => {
    borrowed = consumeHydrationValue('foreign');
    return p;
  });
  try {
    expect(borrowed).toBeUndefined();
    expect(unrelated.isConnected).toBe(true);
    expect(foreignCache.isConnected).toBe(true);
    expect(unrelated.nextElementSibling).toBe(foreignCache);
  } finally {
    owner.unmount();
  }
});
