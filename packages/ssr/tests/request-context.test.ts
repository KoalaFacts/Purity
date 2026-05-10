// @vitest-environment jsdom
// Tests for `getRequest()` + `request` option on the SSR renderers.
// ADR 0009.

import { getRequest, head, suspense } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderToStream, renderToString } from '../src/index.ts';

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe('getRequest() — renderToString', () => {
  it('exposes the supplied Request to components during SSR', async () => {
    const req = new Request('https://example.com/posts/42?ref=email', {
      headers: { 'x-trace-id': 'abc-123', cookie: 'session=ok' },
    });

    let seen: Request | null = null;
    const App = () => {
      seen = getRequest();
      return ssrHtml`<p>${seen?.url ?? 'no req'}</p>`;
    };

    const out = await renderToString(App, { request: req });
    expect(seen).toBe(req);
    expect(out).toContain('https://example.com/posts/42?ref=email');
  });

  it('exposes headers via the standard Request API', async () => {
    const req = new Request('https://example.com/', {
      headers: { 'x-purity-test': 'value' },
    });
    let header: string | null = null;
    const App = () => {
      header = getRequest()?.headers.get('x-purity-test') ?? null;
      return ssrHtml`<p>${header ?? ''}</p>`;
    };
    await renderToString(App, { request: req });
    expect(header).toBe('value');
  });

  it('returns null when no request is passed', async () => {
    let seen: Request | null = null;
    const App = () => {
      seen = getRequest();
      return ssrHtml`<p></p>`;
    };
    await renderToString(App);
    expect(seen).toBeNull();
  });

  it('returns null on the client (no SSRRenderContext)', () => {
    expect(getRequest()).toBeNull();
  });

  it('survives across the multi-pass resource loop (same instance each pass)', async () => {
    const { resource } = await import('@purityjs/core');
    const req = new Request('https://example.com/');
    const seen: Request[] = [];
    const App = () => {
      const r = getRequest();
      if (r) seen.push(r);
      // A resource forces a 2nd pass; getRequest() must surface the same
      // Request on every pass.
      const data = resource(() => Promise.resolve('loaded'), { initialValue: 'loading' });
      return ssrHtml`<p>${() => data()}</p>`;
    };
    await renderToString(App, { request: req });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const s of seen) expect(s).toBe(req);
  });

  it('integrates with head() — per-request canonical link via request.url', async () => {
    const req = new Request('https://example.com/blog/hello-world?utm=campaign');
    const App = () => {
      const r = getRequest();
      if (r) {
        const u = new URL(r.url);
        const canonical = `${u.origin}${u.pathname}`;
        head(ssrHtml`<link rel="canonical" href="${canonical}">`);
      }
      return ssrHtml`<main></main>`;
    };
    const out = await renderToString(App, { request: req, extractHead: true });
    expect(out.head).toBe('<link rel="canonical" href="https://example.com/blog/hello-world"/>');
  });
});

describe('getRequest() — renderToStream', () => {
  it('exposes the supplied Request to the shell render', async () => {
    const req = new Request('https://example.com/dashboard');
    let seen: Request | null = null;
    const App = () => {
      seen = getRequest();
      return ssrHtml`<main>${() => seen?.url ?? ''}</main>`;
    };
    const out = await streamToString(renderToStream(App, { request: req }));
    expect(seen).toBe(req);
    expect(out).toContain('https://example.com/dashboard');
  });

  it('exposes the same Request to suspense() boundary renders', async () => {
    const req = new Request('https://example.com/');
    const seenInsideBoundary: (Request | null)[] = [];

    const App = () =>
      ssrHtml`<main>${suspense(
        () => {
          seenInsideBoundary.push(getRequest());
          return ssrHtml`<aside>resolved</aside>`;
        },
        () => ssrHtml`<aside>…</aside>`,
      )}</main>`;

    await streamToString(renderToStream(App, { request: req }));
    expect(seenInsideBoundary.length).toBeGreaterThan(0);
    for (const r of seenInsideBoundary) expect(r).toBe(req);
  });

  it('returns null inside the shell when no request is passed', async () => {
    let seen: Request | null = null;
    const App = () => {
      seen = getRequest();
      return ssrHtml`<main></main>`;
    };
    await streamToString(renderToStream(App));
    expect(seen).toBeNull();
  });
});
