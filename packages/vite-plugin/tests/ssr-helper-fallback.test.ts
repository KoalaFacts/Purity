import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import * as ssrRuntime from '@purityjs/ssr/runtime';

// Simulate a future compiler output that accesses the helper object in a way
// the dependency analyzer does not know how to narrow safely.
const generated = vi.hoisted(() => ({ body: '' }));
vi.mock('@purityjs/compiler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@purityjs/compiler')>();
  return { ...actual, generateSSR: () => generated.body };
});

import { purity } from '../src/index.ts';

describe('SSR helper dependency fallback', () => {
  beforeEach(() => {
    generated.body = 'function(_v,_h){return _h["mark"]("<p>fallback</p>")}';
  });

  it('retains the complete helper object for computed access', () => {
    const source = "import { html } from '@purityjs/core/jit'; const output = html`<p>x</p>`;";
    const result = purity().transform(source, 'fixture.ts', { ssr: true });
    expect(result?.code).toContain('ssrHelpers as __purity_h__');
    const body = result!.code.replace(/^import .+$/gm, '');
    const output = new Function('__purity_h__', `${body}; return output;`)(ssrRuntime.ssrHelpers);
    expect(ssrRuntime.isSSRHtml(output)).toBe(true);
    expect(output.__purity_ssr_html__).toBe('<p>fallback</p>');
  });

  it('retains the complete helper object when the factory passes it elsewhere', () => {
    generated.body = 'function(_v,_h){return (function(x){return x.mark("ok")})(_h)}';
    const source = "import { html } from '@purityjs/core/jit'; const output = html`<p>x</p>`;";
    const result = purity().transform(source, 'fixture.ts', { ssr: true });
    expect(result?.code).toContain('ssrHelpers as __purity_h__');
    const body = result!.code.replace(/^import .+$/gm, '');
    const output = new Function('__purity_h__', `${body}; return output;`)(ssrRuntime.ssrHelpers);
    expect(output.__purity_ssr_html__).toBe('ok');
  });

  it('retains the complete helper object for an unknown method', () => {
    generated.body = 'function(_v,_h){return _h.future(_v)}';
    const source = "import { html } from '@purityjs/core/jit'; const output = html`<p>x</p>`;";
    const result = purity().transform(source, 'fixture.ts', { ssr: true });
    expect(result?.code).toContain('ssrHelpers as __purity_h__');
  });

  it('retains the complete helper object when generated code assigns a known method', () => {
    generated.body = 'function(_v,_h){_h.mark=_v[0];return _h.mark("ok")}';
    const source = "import { html } from '@purityjs/core/jit'; const output = html`<p>x</p>`;";
    const result = purity().transform(source, 'fixture.ts', { ssr: true });
    expect(result?.code).toContain('ssrHelpers as __purity_h__');
  });
});
