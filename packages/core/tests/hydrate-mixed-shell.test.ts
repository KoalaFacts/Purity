import { it, expect } from 'vite-plus/test';
import { hydrate } from '../src/index.ts';
import { clearHydrationCache, consumeHydrationValue } from '../src/ssr/hydration-cache.ts';
it.each(['inside', 'adjacent'])(
  'streamed boundary overrides %s shell on the same key',
  (placement) => {
    clearHydrationCache();
    document.body.innerHTML =
      '<div><p>server</p><script type="application/json" id="__purity_resources_1__">{"keyed":{"key":"stream"}}</script></div><script type="application/json" id="__purity_resources__">{"keyed":{"key":"shell"}}</script>';
    const host = document.querySelector('div')!;
    if (placement === 'inside') host.append(document.getElementById('__purity_resources__')!);
    const owner = hydrate(host, () => host.querySelector('p')!);
    const value = consumeHydrationValue('key');
    owner.unmount();
    document.body.innerHTML = '';
    expect(value).toBe('stream');
  },
);
