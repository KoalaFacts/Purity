// @vitest-environment jsdom
// Tests for `island(view)` SSR passthrough — ADR 0038 Phase 1.
//
// Phase 1 is brand-only: an islanded view must produce byte-identical
// SSR output to the unwrapped view. Phase 2 adds the per-island
// bootstrap script and breaks byte-equality intentionally.

import { html as clientHtml, island, state } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderToString } from '../src/index.ts';

describe('island() — SSR passthrough (Phase 1)', () => {
  it('produces byte-identical HTML to the unwrapped view (static)', async () => {
    const View = () => ssrHtml`<aside class="x"><h2>hi</h2></aside>`;

    const plain = await renderToString(View);
    const wrapped = await renderToString(island(View));

    expect(wrapped).toBe(plain);
  });

  it('produces byte-identical HTML when nested inside a parent template', async () => {
    const View = () => ssrHtml`<span>${'counter'}</span>`;
    const PageA = () => ssrHtml`<main>${View()}</main>`;
    const PageB = () => ssrHtml`<main>${island(View, { hydrate: 'visible' })()}</main>`;

    const a = await renderToString(PageA);
    const b = await renderToString(PageB);

    expect(b).toBe(a);
  });

  it('produces byte-identical HTML when passed as a function reference into a slot', async () => {
    // Templates that receive a function (not its call) invoke it as part of
    // the SSR value-to-html coercion. An islanded function must coerce the
    // same way an unwrapped function does.
    const View = () => ssrHtml`<em>x</em>`;
    const a = await renderToString(() => ssrHtml`<p>${View}</p>`);
    const b = await renderToString(() => ssrHtml`<p>${island(View)}</p>`);

    expect(b).toBe(a);
  });

  it('does not interfere with reactive expressions inside the islanded view', async () => {
    const label = state('hello');
    const View = () => ssrHtml`<button>${() => label()}</button>`;

    const plain = await renderToString(View);
    const wrapped = await renderToString(island(View, { hydrate: 'idle' }));

    expect(wrapped).toBe(plain);
  });

  it('client and server templates remain interoperable when one is islanded', async () => {
    // Sanity: the client `html` tag isn't tested here (that's the brand
    // test), but importing it alongside the SSR tag must not pull a
    // different code path that the brand could perturb.
    expect(typeof clientHtml).toBe('function');
    const View = () => ssrHtml`<i>ok</i>`;
    expect(await renderToString(island(View))).toBe(await renderToString(View));
  });
});
