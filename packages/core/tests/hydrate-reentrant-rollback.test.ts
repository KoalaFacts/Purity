import { expect, it, beforeEach } from 'vite-plus/test';
import { withoutScope } from '../src/scope.ts';
import { hydrate, onError, onDispose } from '../src/component.ts';
import { primeHydrationCache, consumeHydrationValue } from '../src/ssr/hydration-cache.ts';
beforeEach(() => {
  document.body.innerHTML = '';
});
function root(value: string, isolated = false) {
  const doc = isolated ? document.implementation.createHTMLDocument() : document;
  const host = doc.createElement('div');
  doc.body.append(host);
  host.innerHTML =
    '<p>server</p><script type="application/json" id="__purity_resources__">' +
    JSON.stringify({ keyed: { key: value } }) +
    '</script>';
  return host;
}
for (const hook of ['error', 'dispose'] as const)
  for (const other of [false, true])
    it(`${hook} retry ${other ? 'other' : 'same'} root retains successful state`, () => {
      primeHydrationCache({ keyed: { key: 'prior' } });
      const host = root('outer');
      const target = other ? root('inner', true) : host;
      const nodes = Array.from(host.childNodes);
      let retry: ReturnType<typeof hydrate> | undefined;
      let disposed = 0;
      const recover = () => {
        retry = hydrate(target, () => target.querySelector('p')!);
      };
      const attempt = () =>
        hydrate(host, () => {
          onDispose(() => {
            disposed++;
            if (hook === 'dispose') recover();
          });
          if (hook === 'error') {
            onError(recover);
            throw Error('first');
          }
          return document.createElement('section');
        });
      if (hook === 'dispose') expect(attempt).toThrow('hydratable');
      else attempt();
      expect(disposed).toBe(1);
      expect(consumeHydrationValue('key')).toBe(other ? 'inner' : 'outer');
      expect(target.querySelectorAll('script')).toHaveLength(0);
      if (other) expect(Array.from(host.childNodes)).toEqual(nodes);
      retry!.unmount();
      expect(target.childNodes).toHaveLength(0);
      host.remove();
      target.remove();
    });
it('does not overwrite another root committed during component execution', () => {
  primeHydrationCache({ keyed: { key: 'prior' } });
  const host = root('outer'),
    other = root('inner', true);
  let retry: ReturnType<typeof hydrate> | undefined;
  expect(() =>
    hydrate(host, () => {
      retry = withoutScope(() => hydrate(other, () => other.querySelector('p')!));
      return document.createElement('section');
    }),
  ).toThrow('hydratable');
  expect(other.querySelector('p')).not.toBeNull();
  expect(consumeHydrationValue('key')).toBe('inner');
  retry!.unmount();
  host.remove();
  other.remove();
});
it('does not resurrect scripts after independent same-root success during render', () => {
  primeHydrationCache({ keyed: { key: 'prior' } });
  const host = root('outer');
  let retry: ReturnType<typeof hydrate> | undefined;
  expect(() =>
    hydrate(host, () => {
      retry = withoutScope(() => hydrate(host, () => host.querySelector('p')!));
      return document.createElement('section');
    }),
  ).toThrow('hydratable');
  expect(host.querySelector('p')).not.toBeNull();
  expect(host.querySelectorAll('script')).toHaveLength(0);
  // This nested nonempty root has no remaining scripts: the new root contract clears cache.
  expect(consumeHydrationValue('key')).toBeUndefined();
  retry!.unmount();
  expect(host.childNodes).toHaveLength(0);
  host.remove();
});
it('restores script identity and cache while propagating an unhandled render error and cleaning owner', () => {
  primeHydrationCache({ keyed: { key: 'prior' } });
  const host = root('outer');
  const nodes = Array.from(host.childNodes);
  const error = Error('render');
  let disposed = 0;
  expect(() =>
    hydrate(host, () => {
      onDispose(() => disposed++);
      throw error;
    }),
  ).toThrow(error);
  expect(disposed).toBe(1);
  expect(Array.from(host.childNodes)).toEqual(nodes);
  expect(consumeHydrationValue('key')).toBe('prior');
  host.remove();
});
for (const empty of [false, true])
  it(`protects successful ${empty ? 'empty-root' : 'mismatch'} fallback from an outer rollback`, () => {
    primeHydrationCache({ keyed: { key: 'prior' } });
    const host = root('outer');
    let retry: ReturnType<typeof hydrate> | undefined;
    let calls = 0;
    expect(() =>
      hydrate(host, () => {
        if (empty) host.replaceChildren();
        retry = withoutScope(() =>
          hydrate(host, () => {
            if (!empty && ++calls === 1)
              return {
                __purity_deferred__: true,
                values: [],
                hydrate: () => {
                  throw Error('controlled walker mismatch');
                },
              };
            const node = document.createElement('p');
            node.textContent = 'mounted recovery';
            return node;
          }),
        );
        return document.createElement('section');
      }),
    ).toThrow('hydratable');
    expect(host.textContent).toBe('mounted recovery');
    expect(host.querySelectorAll('script')).toHaveLength(0);
    // Empty-root mount does not prime; a nonempty scriptless retry clears its cache.
    expect(consumeHydrationValue('key')).toBe(empty ? 'outer' : undefined);
    retry!.unmount();
    expect(host.childNodes).toHaveLength(0);
  });
it('does not treat a handled empty-root mount error as a successful cache owner', () => {
  primeHydrationCache({ keyed: { key: 'prior' } });
  const host = root('outer');
  const other = document.createElement('div');
  let handled = 0;
  expect(() =>
    hydrate(host, () => {
      withoutScope(() =>
        hydrate(other, () => {
          onError(() => handled++);
          throw Error('handled mount failure');
        }),
      );
      return document.createElement('section');
    }),
  ).toThrow('hydratable');
  expect(handled).toBe(1);
  expect(other.childNodes).toHaveLength(0);
  expect(host.querySelectorAll('script')).toHaveLength(1);
  expect(consumeHydrationValue('key')).toBe('prior');
});
