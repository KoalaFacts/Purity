// @vitest-environment jsdom
import { afterEach, expect, it } from 'vite-plus/test';
import { onDispose } from '../src/component.ts';
import { renderCompiledTemplate } from '../src/compiler/hydrate-runtime.ts';
import { component } from '../src/elements.ts';
import { hydrate } from '../src/hydrate.ts';
import { clearHydrationCache } from '../src/ssr/hydration-cache.ts';

afterEach(() => {
  document.body.replaceChildren();
  clearHydrationCache();
});

function serverElement(tag: string) {
  const element = document.createElement(tag);
  const original = document.createElement('span');
  original.textContent = 'server shadow';
  element.shadowRoot!.append(original);

  const host = document.createElement('main');
  const script = document.createElement('script');
  script.id = '__purity_resources__';
  script.type = 'application/json';
  script.textContent = '{"keyed":{"ce":"server value"}}';
  host.append(element, script);
  document.body.append(host);
  return { host, element, original, script };
}

it('retries a real Custom Element after its SSR render throws without consuming root serialization', () => {
  const failure = new Error('first CE render fails');
  let renders = 0;
  let disposed = 0;
  const tag = 'purity-ce-ssr-render-retry';
  component(tag, () => {
    onDispose(() => disposed++);
    if (++renders === 1) throw failure;
    const span = document.createElement('span');
    span.textContent = 'client shadow';
    return span;
  });
  const { host, element, original, script } = serverElement(tag);

  expect(() => hydrate(host, () => element)).toThrow(failure);
  expect(disposed).toBe(1);
  expect(element.shadowRoot!.firstChild).toBe(original);
  expect(script.parentNode).toBe(host);

  const retry = hydrate(host, () => element);
  expect(renders).toBe(2);
  expect(element.shadowRoot!.textContent).toBe('client shadow');
  expect(script.parentNode).toBeNull();
  retry.unmount();
  expect(disposed).toBe(2);
});

it('disposes a real Custom Element owner and retries when its deferred SSR walker throws', () => {
  const failure = new Error('first CE walker fails');
  let walks = 0;
  let disposed = 0;
  const tag = 'purity-ce-ssr-walker-retry';
  component(tag, () => {
    onDispose(() => disposed++);
    return renderCompiledTemplate(
      () => document.createElement('span'),
      (_values, _watch, root) => {
        if (++walks === 1) throw failure;
        return root.firstChild!;
      },
      [],
    );
  });
  const { host, element, original, script } = serverElement(tag);

  expect(() => hydrate(host, () => element)).toThrow(failure);
  expect(disposed).toBe(1);
  expect(element.shadowRoot!.firstChild).toBe(original);
  expect(script.parentNode).toBe(host);

  const retry = hydrate(host, () => element);
  expect(walks).toBe(2);
  expect(element.shadowRoot!.firstChild).toBe(original);
  expect(script.parentNode).toBeNull();
  retry.unmount();
  expect(disposed).toBe(2);
});

it('retries an adopted parent after a nested Custom Element hydration hook throws', () => {
  const failure = new Error('nested CE hook failed');
  let nestedCalls = 0;
  let disposed = 0;
  const tag = 'purity-ce-ssr-nested-hook-retry';
  component(tag, () => {
    onDispose(() => disposed++);
    return renderCompiledTemplate(
      () => document.createElement('span'),
      (_values, _watch, root) => root.firstChild!,
      [],
    );
  });
  const { host, element, original, script } = serverElement(tag);
  const nested = document.createElement('p-nested-hydration-hook');
  (nested as HTMLElement & { _hydrateSSR?: () => void })._hydrateSSR = () => {
    if (++nestedCalls === 1) throw failure;
  };
  element.shadowRoot!.appendChild(nested);

  expect(() => hydrate(host, () => element)).toThrow(failure);
  expect(disposed).toBe(1);
  expect(element.shadowRoot!.firstChild).toBe(original);
  expect(nested.parentNode).toBe(element.shadowRoot);
  expect(script.parentNode).toBe(host);

  const retry = hydrate(host, () => element);
  expect(nestedCalls).toBe(2);
  expect(script.parentNode).toBeNull();
  retry.unmount();
  expect(disposed).toBe(2);
});
