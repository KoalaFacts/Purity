// @vitest-environment jsdom
// Tests for `renderStatic` — ADR 0010.
//
// Pure composition over renderToString — no filesystem assertions; we just
// check the returned `files` map.

import { getRequest, head, resource, suspense } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderStatic } from '../src/index.ts';

const SHELL =
  '<!doctype html><html><head>{{head}}</head><body><div id="app">{{body}}</div></body></html>';

describe('renderStatic — composes routes via renderToString', () => {
  it('renders each route to its own HTML string', async () => {
    const { files, errors } = await renderStatic({
      routes: ['/', '/about', '/blog'],
      handler: (req) => {
        const path = new URL(req.url).pathname;
        return () => ssrHtml`<main>route: ${path}</main>`;
      },
      shellTemplate: SHELL,
    });
    expect(errors.size).toBe(0);
    expect(files.size).toBe(3);
    expect(files.get('/')).toContain('<main>route: <!--[-->/<!--]--></main>');
    expect(files.get('/about')).toContain('<main>route: <!--[-->/about<!--]--></main>');
    expect(files.get('/blog')).toContain('<main>route: <!--[-->/blog<!--]--></main>');
  });

  it('splices head() collected markup into {{head}}', async () => {
    const { files } = await renderStatic({
      routes: ['/'],
      handler: () => () => {
        head(ssrHtml`<title>Home</title>`);
        head(ssrHtml`<meta name="description" content="x">`);
        return ssrHtml`<main></main>`;
      },
      shellTemplate: SHELL,
    });
    const out = files.get('/')!;
    // SSR codegen self-closes void elements with `/>`.
    expect(out).toContain('<head><title>Home</title><meta name="description" content="x"/></head>');
  });

  it('exposes getRequest() per route', async () => {
    const seen: string[] = [];
    await renderStatic({
      routes: ['/a', '/b'],
      handler: () => () => {
        const url = getRequest()?.url ?? '';
        seen.push(url);
        return ssrHtml`<p>${url}</p>`;
      },
      shellTemplate: SHELL,
    });
    expect(seen).toEqual(expect.arrayContaining(['http://localhost/a', 'http://localhost/b']));
  });

  it('honors the supplied baseUrl', async () => {
    const seen: string[] = [];
    await renderStatic({
      routes: ['/x'],
      baseUrl: 'https://prod.example.com',
      handler: () => () => {
        seen.push(getRequest()?.url ?? '');
        return ssrHtml`<p></p>`;
      },
    });
    expect(seen).toEqual(['https://prod.example.com/x']);
  });

  it('honors a per-route supplied Request (overrides synthetic one)', async () => {
    const customReq = new Request('https://example.com/custom', {
      headers: { 'x-trace-id': '42' },
    });
    let seen: string | null = null;
    await renderStatic({
      routes: [{ path: '/custom', request: customReq }],
      handler: () => () => {
        seen = getRequest()?.headers.get('x-trace-id') ?? null;
        return ssrHtml`<p></p>`;
      },
    });
    expect(seen).toBe('42');
  });

  it('returns body directly when no shellTemplate is provided', async () => {
    const { files } = await renderStatic({
      routes: ['/'],
      handler: () => () => ssrHtml`<main>raw</main>`,
    });
    expect(files.get('/')).toBe('<main>raw</main>');
  });

  it('prepends head() markup when shellTemplate has no {{head}} placeholder', async () => {
    const { files } = await renderStatic({
      routes: ['/'],
      handler: () => () => {
        head(ssrHtml`<title>Hi</title>`);
        return ssrHtml`<main></main>`;
      },
      shellTemplate: '<html><body>{{body}}</body></html>',
    });
    // No {{head}} placeholder — head markup is prepended so it isn't lost.
    expect(files.get('/')).toBe('<title>Hi</title><html><body><main></main></body></html>');
  });

  it('collects per-route errors without aborting the batch', async () => {
    const { files, errors } = await renderStatic({
      routes: ['/ok', '/boom', '/ok2'],
      handler: (req) => {
        if (req.url.endsWith('/boom')) {
          return () => {
            throw new Error('boom');
          };
        }
        return () => ssrHtml`<p>ok</p>`;
      },
      shellTemplate: SHELL,
    });
    expect(files.has('/ok')).toBe(true);
    expect(files.has('/ok2')).toBe(true);
    expect(files.has('/boom')).toBe(false);
    expect(errors.get('/boom')).toBeInstanceOf(Error);
    expect(String(errors.get('/boom'))).toContain('boom');
  });

  it('awaits resource() data inside each route render', async () => {
    const { files } = await renderStatic({
      routes: ['/'],
      handler: () => () => {
        const r = resource(() => Promise.resolve('RESOLVED'), { initialValue: 'loading' });
        return ssrHtml`<p>${() => r()}</p>`;
      },
      shellTemplate: SHELL,
    });
    expect(files.get('/')).toContain('RESOLVED');
    expect(files.get('/')).not.toMatch(/>loading</);
  });

  it('streams completed routes through onRoute as they finish', async () => {
    const seen: string[] = [];
    await renderStatic({
      routes: ['/a', '/b', '/c'],
      handler: (req) => () => ssrHtml`<p>${req.url}</p>`,
      shellTemplate: SHELL,
      onRoute: (path) => {
        seen.push(path);
      },
    });
    expect(seen.sort()).toEqual(['/a', '/b', '/c']);
  });

  it('respects concurrency: 1 (serial rendering)', async () => {
    // Concurrency is best observed via timing — but a deterministic check is
    // that the implementation doesn't fall over with the bounded path.
    const { files, errors } = await renderStatic({
      routes: ['/a', '/b', '/c', '/d'],
      handler: (req) => () => ssrHtml`<p>${req.url}</p>`,
      shellTemplate: SHELL,
      concurrency: 1,
    });
    expect(errors.size).toBe(0);
    expect(files.size).toBe(4);
  });

  it('handles a suspense() boundary inside an SSG render', async () => {
    const { files } = await renderStatic({
      routes: ['/'],
      handler: () => () =>
        ssrHtml`<main>${suspense(
          () => {
            const r = resource(() => Promise.resolve('LATE'), { initialValue: undefined });
            return ssrHtml`<aside>${() => r()}</aside>`;
          },
          () => ssrHtml`<aside>…</aside>`,
        )}</main>`,
      shellTemplate: SHELL,
    });
    // renderToString resolves the boundary inline (buffered render), so the
    // SSG output has the resolved view rather than the fallback.
    expect(files.get('/')).toContain('LATE');
    expect(files.get('/')).not.toContain('<aside>…</aside>');
  });
});
