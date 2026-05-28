// @vitest-environment jsdom
// Tests for `island(view, options)` — ADR 0038 Phase 1.
//
// Phase 1 ships the brand mechanism only. The wrapped view must:
//   - render identically to the unwrapped view (CSR; SSR parity is
//     covered in @purityjs/ssr's island-passthrough.test.ts);
//   - carry a non-enumerable brand readable via getIslandBrand();
//   - default the trigger to 'load' when no options are passed;
//   - leave the user's view function untouched.

import { describe, expect, it } from 'vitest';
import { html } from '../src/compiler/compile.ts';
import { mount } from '../src/component.ts';
import { getIslandBrand, island, isIsland } from '../src/island.ts';
import { state } from '../src/signals.ts';
import {
  popSSRRenderContext,
  pushSSRRenderContext,
  type SSRRenderContext,
} from '../src/ssr-context.ts';

describe('island() — Phase 1 brand', () => {
  it('defaults the trigger to "load" when no options are passed', () => {
    const view = () => document.createElement('span');
    const wrapped = island(view);
    expect(getIslandBrand(wrapped)?.trigger).toBe('load');
  });

  it('records the trigger from options', () => {
    const view = () => document.createElement('span');
    expect(getIslandBrand(island(view, { hydrate: 'visible' }))?.trigger).toBe('visible');
    expect(getIslandBrand(island(view, { hydrate: 'idle' }))?.trigger).toBe('idle');
    expect(getIslandBrand(island(view, { hydrate: 'interact' }))?.trigger).toBe('interact');
    expect(getIslandBrand(island(view, { hydrate: 'media:(min-width: 768px)' }))?.trigger).toBe(
      'media:(min-width: 768px)',
    );
  });

  it('exposes the original view function on the brand', () => {
    const view = () => document.createElement('span');
    expect(getIslandBrand(island(view))?.view).toBe(view);
  });

  it('isIsland() distinguishes branded from plain functions', () => {
    const plain = () => document.createElement('span');
    expect(isIsland(plain)).toBe(false);
    expect(isIsland(island(plain))).toBe(true);
    expect(isIsland(null)).toBe(false);
    expect(isIsland(undefined)).toBe(false);
    expect(isIsland('string')).toBe(false);
    expect(isIsland({})).toBe(false);
  });

  it('getIslandBrand() returns undefined for non-island values', () => {
    expect(getIslandBrand(() => document.createElement('span'))).toBeUndefined();
  });

  it('does not mutate the wrapped view function', () => {
    const view = () => document.createElement('span');
    island(view, { hydrate: 'visible' });
    expect(isIsland(view)).toBe(false);
  });

  it('returns a fresh wrapper on each call (no shared identity)', () => {
    const view = () => document.createElement('span');
    const a = island(view);
    const b = island(view);
    expect(a).not.toBe(b);
    expect(a).not.toBe(view);
  });

  it('hides the brand from for-in / Object.keys enumeration', () => {
    const wrapped = island(() => document.createElement('span'));
    expect(Object.keys(wrapped)).toEqual([]);
    const keys: string[] = [];
    for (const k in wrapped) keys.push(k);
    expect(keys).toEqual([]);
  });

  it('calling the wrapper returns what the inner view returns', () => {
    const sentinel = document.createElement('div');
    const view = () => sentinel;
    expect(island(view)()).toBe(sentinel);
  });
});

describe('island() — SSR branch (synthetic context)', () => {
  // The full SSR integration tests live in @purityjs/ssr's
  // island-passthrough.test.ts. These cases exercise island()'s SSR
  // branch from within @purityjs/core so coverage reflects the branch.

  function withSsrCtx<T>(fn: () => T): T {
    const ctx: SSRRenderContext = {
      pendingPromises: [],
      resolvedData: [],
      resolvedErrors: [],
      resolvedDataByKey: {},
      resolvedErrorsByKey: {},
      resourceCounter: 0,
      suspenseCounter: 0,
      islandCounter: 0,
      boundaryStartTimes: new Map(),
      boundaryDeadlines: new Map(),
      timedOutBoundaries: new Set(),
    };
    pushSSRRenderContext(ctx);
    try {
      return fn();
    } finally {
      popSSRRenderContext();
    }
  }

  it('emits a <purity-island> wrapper around the rendered HTML', () => {
    const View = (): { __purity_ssr_html__: string } => ({
      __purity_ssr_html__: '<span>x</span>',
    });
    const Wrapped = island(View);
    const result = withSsrCtx(() => Wrapped() as { __purity_ssr_html__: string });
    expect(result.__purity_ssr_html__).toBe(
      '<purity-island data-pi-id="1" data-pi-trigger="load" style="display:contents"><span>x</span></purity-island>',
    );
  });

  it('writes the option trigger into data-pi-trigger', () => {
    const View = (): { __purity_ssr_html__: string } => ({
      __purity_ssr_html__: '<i>x</i>',
    });
    const Wrapped = island(View, { hydrate: 'visible' });
    const result = withSsrCtx(() => Wrapped() as { __purity_ssr_html__: string });
    expect(result.__purity_ssr_html__).toContain('data-pi-trigger="visible"');
  });

  it('escapes attribute-unsafe characters in media: triggers', () => {
    const View = (): { __purity_ssr_html__: string } => ({
      __purity_ssr_html__: 'x',
    });
    // Real media queries don't contain `"`, but escAttr should still
    // neutralise the character should it appear.
    const Wrapped = island(View, { hydrate: 'media:(min-width: 768px) and ("foo")' });
    const result = withSsrCtx(() => Wrapped() as { __purity_ssr_html__: string });
    expect(result.__purity_ssr_html__).toContain('&quot;');
  });

  it('allocates a fresh ID per island and resets per render', () => {
    const View = (): { __purity_ssr_html__: string } => ({
      __purity_ssr_html__: 'x',
    });
    const a = island(View);
    const b = island(View);
    const out = withSsrCtx(() => {
      const first = a() as { __purity_ssr_html__: string };
      const second = b() as { __purity_ssr_html__: string };
      return first.__purity_ssr_html__ + second.__purity_ssr_html__;
    });
    expect(out).toContain('data-pi-id="1"');
    expect(out).toContain('data-pi-id="2"');
  });
});

describe('island() — Phase 1 CSR passthrough', () => {
  it('rendering the wrapped view yields the same DOM shape as the unwrapped view', async () => {
    const count = state(0);
    const View = () => html`<button>${() => count()}</button>`;

    const plainHost = document.createElement('div');
    const plainMount = mount(View, plainHost);

    const islandHost = document.createElement('div');
    const islandMount = mount(island(View), islandHost);

    expect(islandHost.innerHTML).toBe(plainHost.innerHTML);

    count(1);
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    expect(islandHost.innerHTML).toBe(plainHost.innerHTML);

    plainMount.unmount();
    islandMount.unmount();
  });

  it('a click handler inside an island fires as it would unwrapped', () => {
    let clicks = 0;
    const View = () => html`<button @click=${() => clicks++}>x</button>`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      const m = mount(island(View, { hydrate: 'visible' }), host);
      const btn = host.querySelector('button')!;
      btn.click();
      expect(clicks).toBe(1);
      m.unmount();
    } finally {
      host.remove();
    }
  });
});
