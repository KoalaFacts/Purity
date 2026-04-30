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

  // --- Template hoisting tests ---

  it('hoists each compiled template to a unique module-scope const', () => {
    const code = `import { html } from '@purityjs/core';\nconst a = html\`<p>A</p>\`;\nconst b = html\`<p>B</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('const __purity_tpl_0 = ');
    expect(result.code).toContain('const __purity_tpl_1 = ');
    // Hoists must precede the user lines that reference them
    expect(result.code.indexOf('const __purity_tpl_0')).toBeLessThan(
      result.code.indexOf('const a ='),
    );
  });

  it('templates inside arrow functions reuse hoisted const (no per-call IIFE)', () => {
    const code = `import { html } from '@purityjs/core';\nconst f = (item) => html\`<div><li>\${item}</li></div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // The arrow body should reference the hoisted tpl, NOT have its own IIFE
    expect(result.code).toContain('const __purity_tpl_0 = ');
    expect(result.code).toMatch(/=> __purity_tpl_0\(\[item\], __purity_w__\)/);
    // Confirm no `(function(){...})()` IIFE remains in the arrow body
    const arrowBody = result.code.slice(result.code.indexOf('(item) =>'));
    expect(arrowBody.includes('(function()')).toBe(false);
  });

  it('hoisted template is referenced exactly once in user code (single source of truth)', () => {
    const code = `import { html } from '@purityjs/core';\nconst f = (label) => html\`<div><span>\${label}</span></div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // One hoist declaration
    const decls = result.code.match(/const __purity_tpl_\d+ = /g);
    expect(decls).not.toBeNull();
    expect(decls!.length).toBe(1);
    // One usage in the arrow body
    const usages = result.code.match(/__purity_tpl_0\(\[/g);
    expect(usages).not.toBeNull();
    expect(usages!.length).toBe(1);
  });

  it('nested templates in expressions also hoist (not duplicated inline)', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${ok ? html\`<span>yes</span>\` : ""}</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result.code).toContain('const __purity_tpl_0');
    expect(result.code).toContain('const __purity_tpl_1');
  });

  // --- Edge cases for transform skip / identifier-prefix / import shapes ---

  it('skips framework-internal files', () => {
    const code = 'html`<p>x</p>`';
    expect(plugin.transform(code, '/x/@purityjs/core/index.ts')).toBeNull();
    expect(plugin.transform(code, '/x/packages/core/index.ts')).toBeNull();
    expect(plugin.transform(code, '/x/packages/vite-plugin/index.ts')).toBeNull();
  });

  it('does not match `xhtml`` (identifier-prefix guard)', () => {
    const code = `import { html } from '@purityjs/core';\nconst x = "xhtml\`not a template\`";\nconst el = html\`<p>real</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // Only the real html`` got compiled; the `xhtml` string literal stays
    expect(result!.code).toContain('xhtml`');
    expect(result!.code.match(/__purity_tpl_/g)!.length).toBe(2); // const + usage
  });

  it('leaves a malformed/unterminated html`` as-is', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>broken`;
    const result = plugin.transform(code, 'app.ts');
    // Plugin should not crash; output may equal input (no `changed`)
    expect(() => plugin.transform(code, 'app.ts')).not.toThrow();
    if (result) {
      expect(result.code).toBeDefined();
    }
  });

  it('leaves side-effect imports untouched (no { ... } binding)', () => {
    const code = `import "side-effect";\nimport { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('import "side-effect"');
  });

  it('leaves default imports untouched', () => {
    const code = `import lib from 'some-pkg';\nimport { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain("import lib from 'some-pkg'");
  });

  it('leaves imports from other packages untouched', () => {
    const code = `import { something } from 'other-pkg';\nimport { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain("from 'other-pkg'");
  });

  it('drops the @purityjs/core import entirely when only html was imported', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // The original `import { html } from '@purityjs/core'` is gone
    // (only the new `__purity_w__` import remains for that module).
    const purityImports = result!.code.match(
      /import\s*\{[^}]*\}\s*from\s*['"]@purityjs\/core['"]/g,
    );
    // Only the watch import should reference @purityjs/core
    expect(purityImports).not.toBeNull();
    expect(purityImports!.every((s) => s.includes('__purity_w__'))).toBe(true);
  });

  it('handles double-quoted import paths (single AND double quotes)', () => {
    const code = `import { html } from "@purityjs/core";\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
  });

  it('handles escape sequences inside the static portion of a template', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p title="a\\\\b">\${x}</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // Either the escape was preserved as-is or compilation handled it without throwing
    expect(result!.code).toContain('createElement');
  });

  it('handles template-string inside expression argument', () => {
    const code =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this string IS the JS source under transformation
      "import { html } from '@purityjs/core';\nconst el = html`<p>${`hello ${name}`}</p>`;";
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
  });

  it('handles file with no html`` literal (returns null)', () => {
    expect(plugin.transform('const x = 1;', 'app.ts')).toBeNull();
  });

  it('handles html`` at the very start of a file (idx === 0)', () => {
    const code = 'html`<p>x</p>`';
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('createElement');
  });

  it('handles `xhtml`` followed by valid html`` (identifier-prefix in compileTemplates)', () => {
    const code = `import { html } from '@purityjs/core';\nconst other = "abchtml\`fake\`";\nconst el = html\`<p>real</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('abchtml`');
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: dollar-curly in the description refers to template syntax under test
  it('skips identifier-prefixed html`` in nested expressions (xhtml`` inside ${...})', () => {
    const code =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this string IS the JS source under transformation
      "import { html } from '@purityjs/core';\nconst el = html`<p>${ /* xhtml`fake` */ x}</p>`;";
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
  });

  it('handles arrow with template-only body (no nested html``)', () => {
    const code = `import { html } from '@purityjs/core';\nconst f = () => "no template here";\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('"no template here"');
  });

  it('preserves @purityjs/core import path inside string literals', () => {
    const code = `import { html } from '@purityjs/core';\nconst path = "@purityjs/core";\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // String literal is untouched (only the import statement is rewritten)
    expect(result!.code).toContain('"@purityjs/core"');
  });

  it('handles import { html } where the import has a closing-brace-and-no-from', () => {
    // Pathological / malformed input — plugin should not crash and should leave it alone
    const code = `import { html } /*from missing*/;\nconst el = html\`<p>x</p>\`;`;
    expect(() => plugin.transform(code, 'app.ts')).not.toThrow();
  });

  it('handles import where module path is unquoted (malformed)', () => {
    const code = `import { html } from @purityjs/core;\nconst el = html\`<p>x</p>\`;`;
    expect(() => plugin.transform(code, 'app.ts')).not.toThrow();
  });

  it('handles escaped backtick inside template-in-expression', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this string IS the JS source under transformation
    const code = "import { html } from '@purityjs/core';\nconst el = html`<p>${`a\\`b`}</p>`;";
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
  });
});
