import { describe, expect, it } from 'vitest';
import { purity } from '../src/index.ts';

describe('@purityjs/vite-plugin', () => {
  const plugin = purity();

  it('has correct plugin name', () => {
    expect(plugin.name).toBe('purity');
  });

  it('enforces pre', () => {
    expect(plugin.enforce).toBe('pre');
  });

  it('skips files without html`', () => {
    expect(plugin.transform('const x = 1;', 'app.ts')).toBeNull();
  });

  it('skips non-matching extensions', () => {
    expect(plugin.transform('html`<div></div>`', 'app.css')).toBeNull();
  });

  it('compiles simple template', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>Hello</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.code).not.toContain('html`');
  });

  it('compiles template with expression', () => {
    const code = `import { html } from '@purityjs/core';\nconst name = 'World';\nconst el = html\`<p>\${name}</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.code).toContain('name');
  });

  it('compiles template with @event', () => {
    const code = `import { html } from '@purityjs/core';\nconst fn = () => {};\nconst el = html\`<button @click=\${fn}>Go</button>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('addEventListener');
  });

  it('adds watch import', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>Test</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('__purity_w__');
    expect(result.code).toContain("from '@purityjs/core'");
  });

  it('removes html from imports', () => {
    const code = `import { html, state } from '@purityjs/core';\nconst el = html\`<p>Hi</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // html should be removed from the import
    expect(result.code).not.toMatch(/import\s*\{[^}]*html[^}]*\}/);
    // state should remain
    expect(result.code).toContain('state');
  });

  it('compiles multiple templates', () => {
    const code = `import { html } from '@purityjs/core';\nconst a = html\`<div>A</div>\`;\nconst b = html\`<p>B</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    const matches = result.code.match(/createElement/g);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves non-template code', () => {
    const code = `import { html, state } from '@purityjs/core';\nconst count = state(0);\nconsole.log('hi');\nconst el = html\`<p>Test</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('state(0)');
    expect(result.code).toContain("console.log('hi')");
  });

  it('respects custom include option', () => {
    const custom = purity({ include: ['.vue'] });
    expect(custom.transform('html`<div></div>`', 'app.vue')).not.toBeNull();
    expect(custom.transform('html`<div></div>`', 'app.ts')).toBeNull();
  });

  // --- Nested template expression tests (bug fix) ---

  it('handles nested html template inside expression', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${ok ? html\`<span>yes</span>\` : ""}</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.code).not.toContain('html`');
  });

  it('handles each() with nested html template in mapFn', () => {
    const code = `import { html, each } from '@purityjs/core';\nconst el = html\`<ul>\${each(items, (item) => html\`<li>\${item.name}</li>\`, (item) => item.id)}</ul>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
  });

  it('handles deeply nested templates (3 levels)', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${show ? html\`<ul>\${items.map(i => html\`<li>\${i}</li>\`)}</ul>\` : ""}</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
  });

  it('handles ternary with string literals in expression', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<span class="pill\${() => x() ? ' active' : ''}">\${label}</span>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('pill');
  });

  it('handles object literal inside expression', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${{ key: 'val' }}</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
  });

  it('handles arrow function with block body in expression', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${() => { const x = 1; return x; }}</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
  });
});
