// @vitest-environment jsdom
// Server-side router behavior. The pure pattern-matching tests live in
// @purityjs/core's router.test.ts; this file covers the SSR integration —
// `currentPath()` reading the request from getRequest() during render.

import { currentPath, matchRoute } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderToString } from '../src/index.ts';

describe('currentPath() — SSR integration', () => {
  it('reads the path from the supplied Request', async () => {
    let seen: string | null = null;
    const App = () => {
      seen = currentPath();
      return ssrHtml`<p>${seen}</p>`;
    };
    await renderToString(App, {
      request: new Request('https://example.com/posts/42?utm=email'),
    });
    expect(seen).toBe('/posts/42');
  });

  it('returns "/" when no request is supplied during SSR', async () => {
    let seen: string | null = null;
    const App = () => {
      seen = currentPath();
      return ssrHtml`<p></p>`;
    };
    await renderToString(App);
    expect(seen).toBe('/');
  });

  it('matchRoute() composes with currentPath() during SSR', async () => {
    let match: ReturnType<typeof matchRoute> | null = null;
    const App = () => {
      match = matchRoute('/users/:id');
      return ssrHtml`<p></p>`;
    };
    await renderToString(App, {
      request: new Request('https://example.com/users/abc-123'),
    });
    expect(match).toEqual({ params: { id: 'abc-123' } });
  });

  it('honors the request URL across SSR multi-pass resource loop', async () => {
    const { resource } = await import('@purityjs/core');
    const seenPaths: string[] = [];
    const App = () => {
      seenPaths.push(currentPath());
      const r = resource(() => Promise.resolve('done'), { initialValue: 'pending' });
      return ssrHtml`<p>${() => r()}</p>`;
    };
    await renderToString(App, {
      request: new Request('https://example.com/stable/path'),
    });
    // 2+ render passes — every pass sees the same path.
    expect(seenPaths.length).toBeGreaterThanOrEqual(2);
    for (const p of seenPaths) expect(p).toBe('/stable/path');
  });
});
