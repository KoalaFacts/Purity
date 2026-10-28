import { afterEach, expect, it } from 'vite-plus/test';
import { hydrate, onDispose } from '../src/component.ts';
import {
  clearHydrationCache,
  consumeHydrationValue,
  primeHydrationCache,
} from '../src/ssr/hydration-cache.ts';

afterEach(() => {
  clearHydrationCache();
  document.body.replaceChildren();
});

it('rolls back hydration cache and ownership when a custom-element hydration hook throws', () => {
  primeHydrationCache({ keyed: { previous: 'kept' } });
  const host = document.createElement('div');
  host.innerHTML =
    '<p>server</p><x-hydrate-failure></x-hydrate-failure>' +
    '<script type="application/json" id="__purity_resources__">' +
    '{"ordered":[],"keyed":{"key":"from-server"}}</script>';
  document.body.append(host);
  const nodes = Array.from(host.childNodes);
  const script = host.querySelector('script')!;
  const element = host.querySelector('x-hydrate-failure')! as Element & {
    _hydrateSSR?: () => void;
  };
  const failure = new Error('custom-element hydrate failure');
  element._hydrateSSR = () => {
    throw failure;
  };

  let disposed = 0;
  const render = () => {
    onDispose(() => disposed++);
    return host.querySelector('p')!;
  };
  expect(() => hydrate(host, render)).toThrow(failure);
  // Failure must not consume the server's serialization or leak the owner.
  expect(Array.from(host.childNodes)).toEqual(nodes);
  expect(script.parentNode).toBe(host);
  expect(consumeHydrationValue('previous')).toBe('kept');
  expect(consumeHydrationValue('key')).toBeUndefined();
  expect(disposed).toBe(1);

  // A corrected hook can retry the exact same SSR DOM and reuse its cache.
  element._hydrateSSR = () => {};
  const retry = hydrate(host, render);
  expect(consumeHydrationValue('key')).toBe('from-server');
  expect(script.parentNode).toBeNull();
  retry.unmount();
  expect(disposed).toBe(2);
  expect(host.childNodes).toHaveLength(0);
});
