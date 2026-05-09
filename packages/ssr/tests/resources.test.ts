import { resource, state } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html, renderToString } from '../src/index.ts';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe('renderToString — resource awaiting', () => {
  it('awaits a single pending resource and renders the resolved value', async () => {
    const out = await renderToString(() => {
      const r = resource(() => Promise.resolve('hello'));
      return html`<p>${() => r() ?? '...'}</p>`;
    });
    expect(out).toContain('<!--[-->hello<!--]-->');
  });

  it('embeds resolved resources into a __purity_resources__ script', async () => {
    const out = await renderToString(() => {
      const r1 = resource(() => Promise.resolve('one'));
      const r2 = resource(() => Promise.resolve('two'));
      return html`<p>${() => r1() ?? ''}</p>
        <p>${() => r2() ?? ''}</p>`;
    });
    expect(out).toContain('<script type="application/json" id="__purity_resources__">');
    expect(out).toContain('"one"');
    expect(out).toContain('"two"');
  });

  it('omits the script when serializeResources is false', async () => {
    const out = await renderToString(
      () => {
        const r = resource(() => Promise.resolve('x'));
        return html`<p>${() => r() ?? ''}</p>`;
      },
      { serializeResources: false },
    );
    expect(out).not.toContain('__purity_resources__');
  });

  it('handles multiple resources resolving in different orders', async () => {
    let resolveSlow: ((v: string) => void) | null = null;
    const slow = new Promise<string>((r) => {
      resolveSlow = r;
    });
    const out = renderToString(() => {
      const r1 = resource(() => slow);
      const r2 = resource(() => Promise.resolve('fast'));
      return html`<p>${() => r1() ?? ''}-${() => r2() ?? ''}</p>`;
    });
    // Resolve slow last to verify the await waits for ALL pending.
    setTimeout(() => resolveSlow!('slow'), 5);
    const result = await out;
    expect(result).toContain('slow');
    expect(result).toContain('fast');
  });

  it('escapes < / > / & in the script payload to prevent injection', async () => {
    const out = await renderToString(() => {
      const r = resource(() => Promise.resolve('</script><script>alert(1)</script>'));
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(out).not.toContain('</script><script>');
    expect(out).toContain('\\u003c/script\\u003e');
  });

  it('times out when a resource never resolves', async () => {
    const promise = renderToString(
      () => {
        const r = resource(() => new Promise<string>(() => {}));
        return html`<p>${() => r() ?? ''}</p>`;
      },
      { timeout: 50 },
    );
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it('propagates resource errors via the resource error() accessor', async () => {
    const out = await renderToString(() => {
      const r = resource<string>(() => Promise.reject(new Error('fetch fail')));
      return html`<p>${() => (r.error() ? 'errored' : 'no')}</p>`;
    });
    expect(out).toContain('<!--[-->errored<!--]-->');
  });

  it('handles a sync (non-promise) fetcher', async () => {
    const out = await renderToString(() => {
      const r = resource(() => 'sync-value');
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(out).toContain('<!--[-->sync-value<!--]-->');
  });

  it('skips the fetcher when source returns null', async () => {
    let fetcherCalls = 0;
    const out = await renderToString(() => {
      const r = resource<string, string>(
        () => null,
        (key) => {
          fetcherCalls++;
          return Promise.resolve(`fetched-${key}`);
        },
      );
      return html`<p>${() => r() ?? 'idle'}</p>`;
    });
    expect(fetcherCalls).toBe(0);
    expect(out).toContain('<!--[-->idle<!--]-->');
  });

  it('uses the source key in the fetcher', async () => {
    const id = state('42');
    const out = await renderToString(() => {
      const r = resource(
        () => id(),
        (key) => Promise.resolve(`user-${key}`),
      );
      return html`<p>${() => r() ?? ''}</p>`;
    });
    expect(out).toContain('<!--[-->user-42<!--]-->');
  });
});

describe('client hydration cache priming', () => {
  it('matches resolved values to resource creation order', async () => {
    // Render twice — first to capture the SSR payload, then verify the
    // shape of the embedded data so the client side can map indices back
    // to resource() call order.
    const out = await renderToString(() => {
      const a = resource(() => Promise.resolve('alpha'));
      const b = resource(() => Promise.resolve('beta'));
      const c = resource(() => Promise.resolve('gamma'));
      return html`<p>${() => a() ?? ''}-${() => b() ?? ''}-${() => c() ?? ''}</p>`;
    });
    const match = out.match(
      /<script type="application\/json" id="__purity_resources__">(.+?)<\/script>/,
    );
    expect(match).not.toBeNull();
    // Decode the payload — undo the < > & escapes from buildResourceScript.
    const decoded = match![1]
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&');
    const parsed = JSON.parse(decoded);
    expect(parsed).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('handles a re-render that produces no new resources', async () => {
    let creates = 0;
    await tick();
    const out = await renderToString(() => {
      creates++;
      const r = resource(() => Promise.resolve('x'));
      return html`<p>${() => r() ?? ''}</p>`;
    });
    // Two passes: first triggers the fetch, second consumes the resolved value.
    expect(creates).toBe(2);
    expect(out).toContain('<!--[-->x<!--]-->');
  });
});
