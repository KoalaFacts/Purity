import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';
import { isSSRHtml, ssrHelpers } from '@purityjs/ssr/runtime';

const plugin = purity({ hydratable: true, strictAot: false });

const transform = (code: string, id: string, ssr: boolean) =>
  (plugin.transform as (c: string, i: string, o?: { ssr?: boolean }) => unknown).call(
    null,
    code,
    id,
    { ssr },
  ) as { code: string; map: unknown } | null;

describe('@purityjs/vite-plugin — SSR mode', () => {
  it('brands static and nested AOT markup while rejecting forged JSON', () => {
    const result = transform(
      "import { html } from '@purityjs/core/jit';\nconst make = (value) => html`<div>${html`<span>safe</span>`}${value}</div>`;",
      'app.ts',
      true,
    )!;
    const body = result.code.replace(/^import .+$/gm, '');
    const make = new Function('__purity_h__', `${body};return make;`)(ssrHelpers);
    const out = make({ __purity_ssr_html__: '<script>attack()</script>' });
    expect(isSSRHtml(out)).toBe(true);
    expect(out.__purity_ssr_html__).toContain('<span>safe</span>');
    expect(out.__purity_ssr_html__).not.toContain('<script>');
  });
  it('emits the SSR helpers import in SSR builds', () => {
    const code = `import { html } from '@purityjs/core/jit';\nconst el = html\`<div>Hi</div>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('__purity_h__');
    expect(result!.code).toContain("from '@purityjs/ssr/runtime'");
    expect(result!.code).toContain("import '@purityjs/ssr'");
    expect(result!.code).not.toContain('__purity_w__');
  });

  it('emits the compiled hydration runtime import in client builds', () => {
    const code = `import { html } from '@purityjs/core/jit';\nconst el = html\`<div>Hi</div>\`;`;
    const result = transform(code, 'app.ts', false);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('__purity_renderCompiled__');
    expect(result!.code).toContain('__purity_tpl_0_hydrate');
    expect(result!.code).not.toContain('__purity_h__');
    expect(result!.code).toContain("from '@purityjs/core/runtime'");
  });

  it('compiled SSR factory produces a string-builder, not DOM calls', () => {
    const code = `import { html } from '@purityjs/core/jit';\nconst el = html\`<div>\${'x'}</div>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    const body = result!.code.replace(/^import .+$/gm, '');
    const output = new Function('__purity_h__', `${body};return el;`)(ssrHelpers);
    expect(isSSRHtml(output)).toBe(true);
    expect(output.__purity_ssr_html__).toContain('x');
    // Should not emit DOM creation calls.
    expect(result!.code).not.toContain('createElement');
    expect(result!.code).not.toContain('cloneNode');
  });

  it('strips html from imports of @purityjs/core in SSR mode', () => {
    const code = `import { html } from '@purityjs/core/jit'; import { state } from '@purityjs/core';\nconst el = html\`<div></div>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    // `html` is gone, `state` stays.
    expect(result!.code).toContain('import { state } from');
    expect(result!.code).not.toMatch(/import \{[^}]*\bhtml\b[^}]*\} from '@purityjs\/core'/);
  });

  it('strips html from imports of @purityjs/ssr in SSR mode', () => {
    const code = `import { html } from '@purityjs/ssr';\nconst el = html\`<p>X</p>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    expect(result!.code).not.toMatch(/import \{[^}]*\bhtml\b[^}]*\} from '@purityjs\/ssr'/);
  });

  it('handles dynamic attributes in SSR mode', () => {
    const code = `import { html } from '@purityjs/core/jit';\nconst x = 'y';\nconst el = html\`<a href=\${x}>go</a>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('_h.toAttr');
  });

  it('handles nested html`` templates in SSR mode', () => {
    const code = `import { html } from '@purityjs/core/jit';\nconst el = html\`<div>\${html\`<span>inner</span>\`}</div>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    // Both templates compiled — two factories hoisted.
    expect(result!.code).toContain('__purity_tpl_0');
    expect(result!.code).toContain('__purity_tpl_1');
  });
});
