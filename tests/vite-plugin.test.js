import { describe, expect, it } from 'vitest';
import { purity } from '../src/compiler/vite-plugin.ts';

describe('purity vite plugin', () => {
  const plugin = purity();

  it('has correct plugin name', () => {
    expect(plugin.name).toBe('purity');
  });

  it('enforces pre', () => {
    expect(plugin.enforce).toBe('pre');
  });

  it('skips files without html`', () => {
    const result = plugin.transform('const x = 1;', 'test.ts');
    expect(result).toBeNull();
  });

  it('skips non-matching file extensions', () => {
    const result = plugin.transform('html`<div></div>`', 'test.css');
    expect(result).toBeNull();
  });

  it('compiles html` templates', () => {
    const code = `
import { html, state } from 'purity';
const frag = html\`<div class="box">Hello</div>\`;
`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.code).toContain('__purity_watch__');
    expect(result.code).not.toContain('html`');
  });

  it('compiles templates with expressions', () => {
    const code = `
import { html, state } from 'purity';
const name = 'World';
const frag = html\`<p>Hello \${name}</p>\`;
`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.code).toContain('name');
  });

  it('compiles templates with event bindings', () => {
    const code = `
import { html } from 'purity';
const handler = () => {};
const frag = html\`<button @click=\${handler}>Go</button>\`;
`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('addEventListener');
  });

  it('compiles templates with :: two-way binding', () => {
    const code = `
import { html, state } from 'purity';
const text = state('');
const frag = html\`<input ::value=\${text} />\`;
`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('addEventListener');
    // Should contain the bind logic
    expect(result.code).toContain('__purity_watch__');
  });

  it('compiles multiple templates in one file', () => {
    const code = `
import { html } from 'purity';
const a = html\`<div>First</div>\`;
const b = html\`<p>Second</p>\`;
`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // Should have two createElement calls (div + p)
    const matches = result.code.match(/createElement/g);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('does not double-add watch import', () => {
    const code = `
import { html, watch } from 'purity';
const frag = html\`<div>Test</div>\`;
`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // Should only have one __purity_watch__ import
    const imports = result.code.match(/__purity_watch__/g);
    // The import line + usages in compiled code
    expect(result.code.split('import').filter((s) => s.includes('__purity_watch__')).length).toBe(
      1,
    );
  });

  it('handles template with arrow function expression', () => {
    const code =
      "import { html } from 'purity';\n" + 'const frag = html`<div>${() => "hello"}</div>`;\n';
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
  });

  it('preserves non-html code', () => {
    const code = `
import { html, state } from 'purity';
const count = state(0);
console.log('hello');
const frag = html\`<p>Test</p>\`;
const x = count() + 1;
`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain("console.log('hello')");
    expect(result.code).toContain('count() + 1');
  });

  it('respects custom include option', () => {
    const customPlugin = purity({ include: ['.vue'] });
    const result = customPlugin.transform('html`<div></div>`', 'app.vue');
    expect(result).not.toBeNull();

    const skipResult = customPlugin.transform('html`<div></div>`', 'app.ts');
    expect(skipResult).toBeNull();
  });
});
