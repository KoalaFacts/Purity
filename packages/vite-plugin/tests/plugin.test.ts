import { describe, expect, it } from 'vitest';
import { purity } from '../src/index.ts';

describe('@purity/vite-plugin', () => {
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
    const code = `import { html } from '@purity/core';\nconst el = html\`<div>Hello</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.code).not.toContain('html`');
  });

  it('compiles template with expression', () => {
    const code = `import { html } from '@purity/core';\nconst name = 'World';\nconst el = html\`<p>\${name}</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.code).toContain('name');
  });

  it('compiles template with @event', () => {
    const code = `import { html } from '@purity/core';\nconst fn = () => {};\nconst el = html\`<button @click=\${fn}>Go</button>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('addEventListener');
  });

  it('adds watch import', () => {
    const code = `import { html } from '@purity/core';\nconst el = html\`<div>Test</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('__purity_w__');
    expect(result.code).toContain("from '@purity/core'");
  });

  it('removes html from imports', () => {
    const code = `import { html, state } from '@purity/core';\nconst el = html\`<p>Hi</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // html should be removed from the import
    expect(result.code).not.toMatch(/import\s*\{[^}]*html[^}]*\}/);
    // state should remain
    expect(result.code).toContain('state');
  });

  it('compiles multiple templates', () => {
    const code = `import { html } from '@purity/core';\nconst a = html\`<div>A</div>\`;\nconst b = html\`<p>B</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    const matches = result.code.match(/createElement/g);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves non-template code', () => {
    const code = `import { html, state } from '@purity/core';\nconst count = state(0);\nconsole.log('hi');\nconst el = html\`<p>Test</p>\`;`;
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
});
