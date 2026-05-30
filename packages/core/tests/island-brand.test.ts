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
import { getIslandBrand, island, isIsland, type IslandOptions } from '../src/island.ts';
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

  // audit-v2: HIGH — throw isolation. If the inner view throws on the SSR
  // path, the island counter must NOT advance, or subsequent islands shift
  // IDs and the position-based pairing in mountIslands desyncs.
  it('rolls the island counter back when the inner view throws (no ID drift)', () => {
    const Bad = (): { __purity_ssr_html__: string } => {
      throw new Error('boom');
    };
    const Good = (): { __purity_ssr_html__: string } => ({
      __purity_ssr_html__: '<span>ok</span>',
    });
    const wrappedBad = island(Bad);
    const wrappedGood = island(Good);
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
      expect(() => wrappedBad()).toThrow('boom');
      // Counter rolled back — next island still claims id 1.
      const out = wrappedGood() as { __purity_ssr_html__: string };
      expect(out.__purity_ssr_html__).toContain('data-pi-id="1"');
      expect(ctx.islandCounter).toBe(1);
    } finally {
      popSSRRenderContext();
    }
  });
});

describe('island() — audit-v2 hardening', () => {
  // audit-v2: MEDIUM — unknown trigger strings must normalize to 'load'
  // instead of flowing through as a foreign data-pi-trigger value that the
  // client runtime would treat as unknown (only to fall back with a warn).
  // We narrow at the source.
  it('normalises an unknown trigger to "load" on the brand', () => {
    const view = () => document.createElement('span');
    const wrapped = island(view, { hydrate: 'totally-bogus' as unknown as 'load' });
    expect(getIslandBrand(wrapped)?.trigger).toBe('load');
  });

  it('accepts media:… triggers with non-empty suffix only', () => {
    const view = () => document.createElement('span');
    expect(getIslandBrand(island(view, { hydrate: 'media:(min-width: 1px)' }))?.trigger).toBe(
      'media:(min-width: 1px)',
    );
    // Empty media: suffix is not a valid trigger — normalise to 'load'.
    expect(getIslandBrand(island(view, { hydrate: 'media:' as 'media:x' }))?.trigger).toBe('load');
  });

  // audit-v2: MEDIUM — prototype-pollution guard on options.hydrate.
  it('does not read options.hydrate from the prototype chain', () => {
    const view = () => document.createElement('span');
    const polluted = Object.create({ hydrate: 'visible' });
    const wrapped = island(view, polluted as IslandOptions);
    expect(getIslandBrand(wrapped)?.trigger).toBe('load');
  });

  it('tolerates a null / non-object options bag', () => {
    const view = () => document.createElement('span');
    // @ts-expect-error — auditing runtime safety against bad call sites.
    expect(getIslandBrand(island(view, null))?.trigger).toBe('load');
    // @ts-expect-error — auditing runtime safety against bad call sites.
    expect(getIslandBrand(island(view, 'load'))?.trigger).toBe('load');
  });

  // audit-v2: MEDIUM — brand object is frozen so user code can't post-hoc
  // mutate `trigger` (which would silently desync SSR / Vite-plugin scan).
  it('freezes the brand against post-hoc mutation', () => {
    const view = () => document.createElement('span');
    const wrapped = island(view, { hydrate: 'visible' });
    const brand = getIslandBrand(wrapped)!;
    expect(Object.isFrozen(brand)).toBe(true);
    expect(() => {
      (brand as unknown as { trigger: string }).trigger = 'evil';
    }).toThrow(TypeError);
    expect(brand.trigger).toBe('visible');
  });

  // audit-v2: MEDIUM — brand descriptor itself remains non-configurable
  // and non-writable so the property can't be redefined or removed.
  it('keeps the brand property non-configurable and non-writable', () => {
    const wrapped = island(() => document.createElement('span'));
    const symbols = Object.getOwnPropertySymbols(wrapped);
    expect(symbols.length).toBeGreaterThan(0);
    const desc = Object.getOwnPropertyDescriptor(wrapped, symbols[0])!;
    expect(desc.configurable).toBe(false);
    expect(desc.writable).toBe(false);
    expect(desc.enumerable).toBe(false);
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
