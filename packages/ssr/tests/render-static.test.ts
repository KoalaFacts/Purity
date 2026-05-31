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

  it('isolates onRoute sink failures from render errors (separate bucket)', async () => {
    // Audit: render-static.ts:140 — onRoute throws should NOT pollute `errors`
    // (which is for render failures); the HTML is already in `files`. Keep
    // sink failures in `onRouteErrors` so callers can distinguish them.
    const { files, errors, onRouteErrors } = await renderStatic({
      routes: ['/a', '/b'],
      handler: () => () => ssrHtml`<p>ok</p>`,
      shellTemplate: SHELL,
      onRoute: (path) => {
        if (path === '/a') throw new Error('disk full');
      },
    });
    // The HTML is still in `files` even though the sink failed.
    expect(files.has('/a')).toBe(true);
    expect(files.has('/b')).toBe(true);
    // Render `errors` is untouched — only the sink bucket carries the throw.
    expect(errors.size).toBe(0);
    expect(onRouteErrors.size).toBe(1);
    expect(String(onRouteErrors.get('/a'))).toContain('disk full');
  });

  it('clones a user-supplied Request so its body survives repeated renders', async () => {
    // Audit: render-static.ts:129 — `route.request` forwarded verbatim would
    // make a re-rendered Request unusable (`TypeError: Body is unusable`)
    // because `renderToString` / `getRequest()` consumers may read the body.
    // The fix is to `.clone()` user-supplied Requests.
    const customReq = new Request('http://localhost/p', {
      method: 'POST',
      body: 'payload',
    });
    // The handler runs synchronously inside renderToString and is the
    // first place that observes the per-route Request. Read the body
    // there so consumption order matches a real router.
    const bodies: string[] = [];
    const drainHandler = async (req: Request) => {
      bodies.push(await req.text());
    };
    // Drain via handler — but renderStatic forwards `request` to the
    // component too, so we just consume it once per render.
    await renderStatic({
      routes: [{ path: '/p', request: customReq }],
      handler: (req) => {
        // Fire-and-await before returning a thunk by hoisting into a
        // promise the test then awaits via `bodies`.
        void drainHandler(req);
        return () => ssrHtml`<p></p>`;
      },
    });
    // Re-render with the same Request: must not throw "Body is unusable".
    await renderStatic({
      routes: [{ path: '/p', request: customReq }],
      handler: (req) => {
        void drainHandler(req);
        return () => ssrHtml`<p></p>`;
      },
    });
    // Allow the drain microtasks to settle.
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(bodies).toEqual(['payload', 'payload']);
  });

  it('rejects unsafe route paths (traversal, protocol-relative, scheme, control chars)', async () => {
    // Audit: render-static.ts:129 — `baseUrl + route.path` is concatenated
    // without normalisation; `..`, `//host`, `http://evil`, CR/LF flow into
    // `new Request()` and downstream filesystem writers. Validate up-front.
    const { files, errors } = await renderStatic({
      routes: [
        '/../../etc/passwd',
        '//evil.example.com/admin',
        'http://evil.example.com/',
        '/ok',
        '/with\r\ninjection',
        '',
        'no-leading-slash',
      ],
      handler: () => () => ssrHtml`<p>safe</p>`,
    });
    expect(files.has('/ok')).toBe(true);
    expect(files.size).toBe(1);
    for (const path of [
      '/../../etc/passwd',
      '//evil.example.com/admin',
      'http://evil.example.com/',
      '/with\r\ninjection',
      '',
      'no-leading-slash',
    ]) {
      expect(errors.has(path)).toBe(true);
      expect(String(errors.get(path))).toContain('unsafe route path');
    }
  });

  it('throws synchronously on an invalid baseUrl', async () => {
    // Audit: render-static.ts — `baseUrl` is concatenated; a scheme-less or
    // garbage value would produce N indistinguishable per-route TypeErrors.
    // Validate once, up-front, with a clear message.
    await expect(
      renderStatic({
        routes: ['/'],
        baseUrl: 'not a url',
        handler: () => () => ssrHtml`<p></p>`,
      }),
    ).rejects.toThrow(/invalid baseUrl/);
  });

  it('places doctype before the shell instead of inside {{body}}', async () => {
    // Audit: render-static.ts — `renderToString` prepends `doctype` inside
    // `body`, so when a `shellTemplate` is supplied the doctype lands
    // *inside* the {{body}} splice (e.g. inside `<div id="app">`).
    // Doctype must be the first bytes of the document.
    const { files } = await renderStatic({
      routes: ['/'],
      handler: () => () => ssrHtml`<main>x</main>`,
      doctype: '<!doctype html>',
      shellTemplate: '<html><head>{{head}}</head><body><div id="app">{{body}}</div></body></html>',
    });
    const out = files.get('/')!;
    expect(out.startsWith('<!doctype html><html>')).toBe(true);
    // The doctype must not appear inside the app container.
    expect(out).not.toContain('<div id="app"><!doctype');
  });

  it('does not expand a {{body}} literal that appears inside rendered head markup', async () => {
    // Audit: applyShell spliced `{{head}}` first, then `{{body}}`, so a
    // `{{body}}` literal in the head HTML would be double-injected. Splice
    // both placeholders in a single pass to defuse cross-contamination.
    const { files } = await renderStatic({
      routes: ['/'],
      handler: () => () => {
        // Inject a head meta whose content contains the literal `{{body}}`.
        head(ssrHtml`<meta name="x" content="{{body}}">`);
        return ssrHtml`<main>REAL_BODY</main>`;
      },
      shellTemplate: SHELL,
    });
    const out = files.get('/')!;
    // The literal `{{body}}` survives inside the meta (was not expanded).
    expect(out).toContain('content="{{body}}"');
    // The real body landed exactly once at the {{body}} placeholder.
    expect(out.match(/REAL_BODY/g)?.length).toBe(1);
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
