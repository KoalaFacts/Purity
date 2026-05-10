import { beforeEach, describe, expect, it } from 'vitest';
import { html, hydrate, resource, state } from '../src/index.ts';
import { primeHydrationCache } from '../src/ssr-context.ts';
import { tick } from './_helpers.ts';

describe('hydrate + resource cache', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    // Cache is module-scoped — clear any leftover entries from prior tests.
    primeHydrationCache([]);
  });

  it('reads __purity_resources__ script and primes the cache', async () => {
    // Stage SSR-style markup: rendered content (with marker-wrapped slot) +
    // the resources script.
    host.innerHTML =
      '<p><!--[-->primed<!--]--></p>' +
      '<script type="application/json" id="__purity_resources__">["primed"]</script>';

    let fetcherCalls = 0;
    hydrate(host, () => {
      const r = resource(() => {
        fetcherCalls++;
        return Promise.resolve('refetched');
      });
      return html`<p>${() => r() ?? 'loading'}</p>`;
    });

    await tick();

    // The cached value seeded `data()` so the first render shows "primed".
    expect(host.textContent).toContain('primed');
    // Fetcher fires once for hydration cache priming watch tracking,
    // but the cached data was used as initial. We don't refetch on hydrate.
    // Looser assertion: fetcher does NOT have a second invocation refetching.
    expect(fetcherCalls).toBeLessThanOrEqual(0);
    // The script was removed so a re-mount doesn't re-prime.
    expect(host.querySelector('#__purity_resources__')).toBeNull();
  });

  it('falls back to normal fetching when no script is present', async () => {
    host.innerHTML = '<p><!--[-->loading<!--]--></p>';

    hydrate(host, () => {
      const r = resource(() => Promise.resolve('fetched'));
      return html`<p>${() => r() ?? 'loading'}</p>`;
    });

    // Initial render shows the loading state.
    expect(host.textContent).toContain('loading');
    // After the fetch promise resolves, the value updates.
    await tick();
    await tick();
    expect(host.textContent).toContain('fetched');
  });

  it('respects creation order for multi-resource cache priming', async () => {
    host.innerHTML =
      '<p><!--[-->A<!--]-->-<!--[-->B<!--]-->-<!--[-->C<!--]--></p>' +
      '<script type="application/json" id="__purity_resources__">["A","B","C"]</script>';

    hydrate(host, () => {
      const a = resource(() => Promise.resolve('a-fetched'));
      const b = resource(() => Promise.resolve('b-fetched'));
      const c = resource(() => Promise.resolve('c-fetched'));
      return html`<p>${() => a() ?? '?'}-${() => b() ?? '?'}-${() => c() ?? '?'}</p>`;
    });

    await tick();
    expect(host.textContent).toContain('A-B-C');
  });

  it('still triggers a refetch when the source key changes after hydration', async () => {
    host.innerHTML =
      '<p><!--[-->primed<!--]--></p>' +
      '<script type="application/json" id="__purity_resources__">["primed"]</script>';

    let fetcherCalls = 0;
    let lastKey: string | null = null;
    const id = state('1');
    hydrate(host, () => {
      const r = resource(
        () => id(),
        (key) => {
          fetcherCalls++;
          lastKey = key;
          return Promise.resolve(`fetched-${key}`);
        },
      );
      return html`<p>${() => r() ?? 'loading'}</p>`;
    });

    await tick();
    expect(host.textContent).toContain('primed');
    expect(fetcherCalls).toBe(0);

    id('2');
    await tick();
    await tick();
    expect(fetcherCalls).toBe(1);
    expect(lastKey).toBe('2');
    expect(host.textContent).toContain('fetched-2');
  });
});

describe('hydrate + keyed resource cache', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    primeHydrationCache([]);
  });

  it('reads the new { ordered, keyed } payload shape and serves keyed values', async () => {
    host.innerHTML =
      '<p><!--[-->primed<!--]--></p>' +
      '<script type="application/json" id="__purity_resources__">' +
      '{"ordered":[],"keyed":{"todos":"primed"}}' +
      '</script>';

    let fetcherCalls = 0;
    hydrate(host, () => {
      const r = resource(
        () => {
          fetcherCalls++;
          return Promise.resolve('refetched');
        },
        { key: 'todos' },
      );
      return html`<p>${() => r() ?? 'loading'}</p>`;
    });
    await tick();

    expect(host.textContent).toContain('primed');
    expect(fetcherCalls).toBeLessThanOrEqual(0);
  });

  it('matches keyed resources even when conditional resources reorder unkeyed neighbors', async () => {
    // Stage a payload where the keyed value is preserved by name even
    // though the ordered array's first slot belongs to a different
    // (conditional, skipped) resource.
    host.innerHTML =
      '<p><!--[-->primed-by-key<!--]--></p>' +
      '<script type="application/json" id="__purity_resources__">' +
      '{"ordered":["wrong-pos-0"],"keyed":{"primary":"primed-by-key"}}' +
      '</script>';

    hydrate(host, () => {
      // Conditional unkeyed resource — never created on the client; would
      // shift the auto-index for the keyed one if we relied on positions.
      const skip = false;
      if (skip) {
        resource(() => Promise.resolve('skipped'));
      }
      const r = resource(() => Promise.resolve('refetched'), { key: 'primary' });
      return html`<p>${() => r() ?? 'loading'}</p>`;
    });
    await tick();

    expect(host.textContent).toContain('primed-by-key');
    expect(host.textContent).not.toContain('wrong-pos-0');
  });

  it('falls back to ordered cache when no key is supplied (legacy path intact)', async () => {
    host.innerHTML =
      '<p><!--[-->A<!--]--></p>' +
      '<script type="application/json" id="__purity_resources__">["A"]</script>';

    hydrate(host, () => {
      const r = resource(() => Promise.resolve('refetched'));
      return html`<p>${() => r() ?? '?'}</p>`;
    });
    await tick();
    expect(host.textContent).toContain('A');
  });
});

describe('hydrate + per-boundary streaming cache (ADR 0006 Phase 6 second-half)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    primeHydrationCache([]);
  });

  it('merges per-boundary <script id="__purity_resources_N__"> into the keyed cache', async () => {
    // Stage what a streamed renderToStream output looks like AFTER all
    // boundaries have swapped: shell prime + two per-boundary primes already
    // sitting in the document.
    host.innerHTML = '<p><!--[-->shell<!--]--></p>';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<script type="application/json" id="__purity_resources__">' +
        '{"ordered":[],"keyed":{"shell":"shell"}}' +
        '</script>' +
        '<script type="application/json" id="__purity_resources_1__">' +
        '{"keyed":{"b1":"first"}}' +
        '</script>' +
        '<script type="application/json" id="__purity_resources_2__">' +
        '{"keyed":{"b2":"second"}}' +
        '</script>',
    );

    let fetches = 0;
    hydrate(host, () => {
      const r1 = resource(
        () => {
          fetches++;
          return Promise.resolve('refetch-1');
        },
        { key: 'b1' },
      );
      const r2 = resource(
        () => {
          fetches++;
          return Promise.resolve('refetch-2');
        },
        { key: 'b2' },
      );
      const shell = resource(
        () => {
          fetches++;
          return Promise.resolve('refetch-shell');
        },
        { key: 'shell' },
      );
      return html`<p>${() => `${shell() ?? '?'}/${r1() ?? '?'}/${r2() ?? '?'}`}</p>`;
    });
    await tick();

    // All three keyed values primed from their respective scripts; no fetches.
    expect(host.textContent).toContain('shell/first/second');
    expect(fetches).toBe(0);
  });

  it('drops per-boundary scripts from the DOM after priming', async () => {
    host.innerHTML = '<p><!--[-->X<!--]--></p>';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<script type="application/json" id="__purity_resources_1__">' +
        '{"keyed":{"k":"v"}}' +
        '</script>',
    );

    hydrate(host, () => {
      const r = resource(() => Promise.resolve('refetched'), { key: 'k' });
      return html`<p>${() => r() ?? '?'}</p>`;
    });
    await tick();

    // The boundary cache script is removed from the DOM after priming so a
    // subsequent re-mount (hot reload, error recovery) doesn't double-prime.
    expect(document.querySelector('script#__purity_resources_1__')).toBeNull();
  });

  it('works without a shell script — boundary-only cache', async () => {
    // No shell-level resources, only a per-boundary prime. The shell script
    // is absent; the boundary script alone should still drive the cache.
    host.innerHTML = '<p><!--[-->X<!--]--></p>';
    document.body.insertAdjacentHTML(
      'beforeend',
      '<script type="application/json" id="__purity_resources_1__">' +
        '{"keyed":{"only":"primed"}}' +
        '</script>',
    );

    let fetches = 0;
    hydrate(host, () => {
      const r = resource(
        () => {
          fetches++;
          return Promise.resolve('refetched');
        },
        { key: 'only' },
      );
      return html`<p>${() => r() ?? '?'}</p>`;
    });
    await tick();

    expect(host.textContent).toContain('primed');
    expect(fetches).toBe(0);
  });
});
