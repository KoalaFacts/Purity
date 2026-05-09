import { describe, expect, it } from 'vitest';
import { purity } from '../src/index.ts';

const plugin = purity();

const transform = (code: string, id: string, ssr: boolean) =>
  (plugin.transform as (c: string, i: string, o?: { ssr?: boolean }) => unknown).call(
    null,
    code,
    id,
    { ssr },
  ) as { code: string; map: unknown } | null;

describe('@purityjs/vite-plugin — SSR mode', () => {
  it('emits the SSR helpers import in SSR builds', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>Hi</div>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('__purity_h__');
    expect(result!.code).toContain("from '@purityjs/core/compiler'");
    expect(result!.code).toContain("import '@purityjs/ssr'");
    expect(result!.code).not.toContain('__purity_w__');
  });

  it('emits the watch import in client builds', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>Hi</div>\`;`;
    const result = transform(code, 'app.ts', false);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('__purity_w__');
    expect(result!.code).not.toContain('__purity_h__');
    expect(result!.code).not.toContain('@purityjs/core/compiler');
  });

  it('compiled SSR factory produces a string-builder, not DOM calls', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${'x'}</div>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    // SSR codegen builds an HTML string via "_o += …" and brands the result
    // with __purity_ssr_html__ via _h.mark(...).
    expect(result!.code).toContain('_o');
    expect(result!.code).toContain('_h.mark(_o)');
    // Should not emit DOM creation calls.
    expect(result!.code).not.toContain('createElement');
    expect(result!.code).not.toContain('cloneNode');
  });

  it('strips html from imports of @purityjs/core in SSR mode', () => {
    const code = `import { html, state } from '@purityjs/core';\nconst el = html\`<div></div>\`;`;
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
    const code = `import { html } from '@purityjs/core';\nconst x = 'y';\nconst el = html\`<a href=\${x}>go</a>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('_h.toAttr');
  });

  it('handles nested html`` templates in SSR mode', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${html\`<span>inner</span>\`}</div>\`;`;
    const result = transform(code, 'app.ts', true);
    expect(result).not.toBeNull();
    // Both templates compiled — two factories hoisted.
    expect(result!.code).toContain('__purity_tpl_0');
    expect(result!.code).toContain('__purity_tpl_1');
  });
});
