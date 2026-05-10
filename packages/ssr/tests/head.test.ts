// @vitest-environment jsdom
// Tests for `head()` — ADR 0008 Phase 1.
//
// `head()` is server-side only in Phase 1; on the client it's a no-op
// since the SSR-rendered <head> is already showing. These tests focus on
// the SSR behavior (collection on the context) and the renderToString
// `extractHead: true` option that surfaces it.

import { head } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderToString } from '../src/index.ts';

describe('head() — SSR collection', () => {
  it('returns { body, head } when extractHead is true', async () => {
    const App = () => {
      head(ssrHtml`<title>Hi</title>`);
      return ssrHtml`<main>body</main>`;
    };
    const out = await renderToString(App, { extractHead: true });
    expect(out.body).toBe('<main>body</main>');
    expect(out.head).toBe('<title>Hi</title>');
  });

  it('concatenates multiple head() calls in declaration order', async () => {
    const App = () => {
      head(ssrHtml`<title>Hi</title>`);
      head(ssrHtml`<meta name="description" content="d">`);
      head(ssrHtml`<link rel="canonical" href="https://example.com">`);
      return ssrHtml`<main></main>`;
    };
    const out = await renderToString(App, { extractHead: true });
    // Void elements are self-closed by the SSR codegen — `<meta>` / `<link>`
    // come out as `<meta .../>` / `<link .../>`. Modern browsers parse both.
    expect(out.head).toBe(
      '<title>Hi</title>' +
        '<meta name="description" content="d"/>' +
        '<link rel="canonical" href="https://example.com"/>',
    );
  });

  it('accepts a thunk and calls it once', async () => {
    let calls = 0;
    const App = () => {
      head(() => {
        calls++;
        return ssrHtml`<title>Hi</title>`;
      });
      return ssrHtml`<main></main>`;
    };
    const out = await renderToString(App, { extractHead: true });
    expect(out.head).toBe('<title>Hi</title>');
    expect(calls).toBe(1);
  });

  it('falls back to string return when extractHead is omitted (back-compat)', async () => {
    const App = () => {
      head(ssrHtml`<title>Hi</title>`);
      return ssrHtml`<main>body</main>`;
    };
    const out = await renderToString(App);
    // Type narrowing: the default overload returns string, not the tuple.
    expect(typeof out).toBe('string');
    expect(out).toBe('<main>body</main>');
  });

  it('ignores head() calls outside an SSR render context (client/test safety)', () => {
    // Bare call — no error, no DOM mutation.
    expect(() => head(ssrHtml`<title>nope</title>`)).not.toThrow();
  });

  it('drops empty / falsy head() contents silently', async () => {
    const App = () => {
      head(undefined);
      head(null);
      head(false);
      head('');
      return ssrHtml`<main></main>`;
    };
    const out = await renderToString(App, { extractHead: true });
    expect(out.head).toBe('');
  });

  it('captures head() entries from the FINAL pass after resource resolution', async () => {
    // A resource forces the renderer through two passes. head() is called
    // each pass; the extractHead result should reflect only the final pass
    // (no doubling), and the title's value should be the resolved one.
    const { resource } = await import('@purityjs/core');
    const App = () => {
      const r = resource(() => Promise.resolve('Loaded'), { initialValue: 'Loading' });
      head(ssrHtml`<title>${() => r()}</title>`);
      return ssrHtml`<main></main>`;
    };
    const out = await renderToString(App, { extractHead: true });
    // Reactive `${() => r()}` slots wrap with the `<!--[-->...<!--]-->`
    // expression marker pair on SSR. The resolved value is the only entry.
    expect(out.head).toBe('<title><!--[-->Loaded<!--]--></title>');
  });

  it('still emits the resource-cache script in body when extractHead is true', async () => {
    // The body should retain its full structure (cache prime included) —
    // extractHead only adds a NEW slot, it doesn't strip anything.
    const App = () => {
      head(ssrHtml`<title>Hi</title>`);
      return ssrHtml`<main>body</main>`;
    };
    const out = await renderToString(App, { extractHead: true, doctype: '<!doctype html>' });
    expect(out.body.startsWith('<!doctype html>')).toBe(true);
    expect(out.body).toContain('<main>body</main>');
    expect(out.head).toBe('<title>Hi</title>');
  });

  it('escapes user-supplied head text via the standard SSR helpers', async () => {
    // The user passes raw SSRHtml so escaping is their responsibility for
    // the markup *shape* — but values inside `${expression}` slots get the
    // standard SSR escaping pipeline.
    const App = () => {
      head(ssrHtml`<title>${'<script>alert(1)</script>'}</title>`);
      return ssrHtml`<main></main>`;
    };
    const out = await renderToString(App, { extractHead: true });
    expect(out.head).toContain('&lt;script&gt;');
    expect(out.head).not.toContain('<script>alert(1)</script>');
  });
});
