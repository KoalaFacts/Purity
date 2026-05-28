// @vitest-environment jsdom
// Tests for `island(view)` SSR output — ADR 0038 Phase 2.
//
// Phase 2 wraps each island in `<purity-island data-pi-id="N"
// data-pi-trigger="…" style="display:contents">…</purity-island>`. The
// inner HTML is exactly what the unwrapped view would have emitted, so
// substring equality holds; only the wrapper differs from Phase 1's
// byte-identical output.

import { html as clientHtml, island, state } from '@purityjs/core';
import { describe, expect, it } from 'vitest';
import { html as ssrHtml, renderToString } from '../src/index.ts';

const WRAPPER_OPEN = (id: number, trigger: string): string =>
  `<purity-island data-pi-id="${id}" data-pi-trigger="${trigger}" style="display:contents">`;
const WRAPPER_CLOSE = '</purity-island>';

describe('island() — SSR wrapper (Phase 2)', () => {
  it('wraps the rendered view in <purity-island> with the default trigger', async () => {
    const View = () => ssrHtml`<aside class="x"><h2>hi</h2></aside>`;
    const inner = await renderToString(View);

    const wrapped = await renderToString(island(View));

    expect(wrapped).toBe(`${WRAPPER_OPEN(1, 'load')}${inner}${WRAPPER_CLOSE}`);
  });

  it('records the trigger from options in the data-pi-trigger attribute', async () => {
    const View = () => ssrHtml`<span>ok</span>`;
    const inner = await renderToString(View);

    expect(await renderToString(island(View, { hydrate: 'visible' }))).toBe(
      `${WRAPPER_OPEN(1, 'visible')}${inner}${WRAPPER_CLOSE}`,
    );
    expect(await renderToString(island(View, { hydrate: 'idle' }))).toBe(
      `${WRAPPER_OPEN(1, 'idle')}${inner}${WRAPPER_CLOSE}`,
    );
    expect(await renderToString(island(View, { hydrate: 'interact' }))).toBe(
      `${WRAPPER_OPEN(1, 'interact')}${inner}${WRAPPER_CLOSE}`,
    );
  });

  it('escapes media: trigger values in the data-pi-trigger attribute', async () => {
    const View = () => ssrHtml`<span>ok</span>`;
    const out = await renderToString(island(View, { hydrate: 'media:(min-width: 768px)' }));
    expect(out).toContain('data-pi-trigger="media:(min-width: 768px)"');
  });

  it('allocates monotonically increasing IDs across multiple islands', async () => {
    const View = () => ssrHtml`<em>x</em>`;
    const out = await renderToString(
      () => ssrHtml`<main>${island(View)()}${island(View, { hydrate: 'visible' })()}</main>`,
    );
    expect(out).toContain('data-pi-id="1"');
    expect(out).toContain('data-pi-id="2"');
    expect(out.indexOf('data-pi-id="1"')).toBeLessThan(out.indexOf('data-pi-id="2"'));
  });

  it("resets island IDs between renders so two pages don't collide", async () => {
    const View = () => ssrHtml`<i>x</i>`;
    const a = await renderToString(island(View));
    const b = await renderToString(island(View));
    expect(a).toBe(b);
    expect(a).toContain('data-pi-id="1"');
  });

  it('preserves nested reactive expressions inside the islanded view', async () => {
    const label = state('hello');
    const View = () => ssrHtml`<button>${() => label()}</button>`;
    const inner = await renderToString(View);

    const out = await renderToString(island(View, { hydrate: 'idle' }));

    expect(out).toBe(`${WRAPPER_OPEN(1, 'idle')}${inner}${WRAPPER_CLOSE}`);
  });

  it('works when the island appears as a function reference in a slot', async () => {
    // Templates that receive a function (not its call) invoke it as part
    // of the SSR value-to-html coercion. The branded function takes the
    // same path: SSR context is on the stack, so the wrapper is emitted.
    // The expression slot itself wraps in hydration markers
    // (<!--[-->/<!--]-->); the island wrapper sits inside.
    const View = () => ssrHtml`<em>x</em>`;
    const inner = await renderToString(View);

    const Wrapped = island(View);
    const out = await renderToString(() => ssrHtml`<p>${Wrapped}</p>`);

    expect(out).toBe(`<p><!--[-->${WRAPPER_OPEN(1, 'load')}${inner}${WRAPPER_CLOSE}<!--]--></p>`);
  });

  it('keeps client and server template tags interoperable', async () => {
    // Sanity: importing both tags must not perturb the wrapper output.
    expect(typeof clientHtml).toBe('function');
    const View = () => ssrHtml`<i>ok</i>`;
    const inner = await renderToString(View);
    expect(await renderToString(island(View))).toBe(
      `${WRAPPER_OPEN(1, 'load')}${inner}${WRAPPER_CLOSE}`,
    );
  });
});
