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

  it('handles multi-line imports without splitting them', () => {
    const code =
      "import {\n  html,\n  state,\n  watch,\n} from '@purityjs/core';\n" +
      "import { foo } from './other.ts';\n" +
      'const el = html`<p>Test</p>`;';
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    // The watch import must be inserted AFTER the multi-line import block,
    // not in the middle of it. Easiest invariant: the rewritten code must
    // be parseable by re-running the regex for any `import {` open without
    // an unmatched close before the next `import` keyword.
    const out = result.code;
    // The injected line should appear after both original imports.
    const injected = out.indexOf("import { watch as __purity_w__ } from '@purityjs/core';");
    expect(injected).toBeGreaterThanOrEqual(0);
    expect(injected).toBeGreaterThan(out.indexOf("from './other.ts'"));
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

// ---------------------------------------------------------------------------
// Source maps
// ---------------------------------------------------------------------------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlqDecodeLine(s: string): number[][] {
  // Decode one ';'-delimited line of v3 mappings into an array of segments,
  // where each segment is the array of signed integers from a VLQ run.
  const segs: number[][] = [];
  for (const segStr of s.split(',')) {
    if (!segStr) continue;
    const seg: number[] = [];
    let v = 0;
    let shift = 0;
    for (let i = 0; i < segStr.length; i++) {
      const c = BASE64.indexOf(segStr[i]);
      const cont = c & 0x20;
      v |= (c & 0x1f) << shift;
      if (cont) {
        shift += 5;
        continue;
      }
      const sign = v & 1;
      const n = v >>> 1;
      seg.push(sign ? -n : n);
      v = 0;
      shift = 0;
    }
    segs.push(seg);
  }
  return segs;
}

describe('@purityjs/vite-plugin source maps', () => {
  const plugin = purity();

  it('returns a v3 source map alongside compiled code', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>Hi</div>\`;`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.map).toBeDefined();
    const map = result!.map!;
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(['app.ts']);
    expect(map.sourcesContent).toEqual([code]);
    expect(map.names).toEqual([]);
    expect(typeof map.mappings).toBe('string');
    expect(map.mappings.length).toBeGreaterThan(0);
  });

  it('emits one mapping line per output line', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>Hi</div>\`;`;
    const result = plugin.transform(code, 'app.ts')!;
    // Number of ';' separators = number of newlines in compiled output.
    const newlineCount = (result.code.match(/\n/g) ?? []).length;
    const semiCount = (result.map!.mappings.match(/;/g) ?? []).length;
    expect(semiCount).toBe(newlineCount);
  });

  it('maps compiled-template lines back to the original html`` line', () => {
    // Original line 1 (0-indexed): `const el = html\`<div>Hi</div>\`;`
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>Hi</div>\`;`;
    const result = plugin.transform(code, 'app.ts')!;
    // Find the output line that contains the compiled call.
    const outLines = result.code.split('\n');
    const compiledLineIdx = outLines.findIndex((l) => l.includes('__purity_tpl_0(['));
    expect(compiledLineIdx).toBeGreaterThanOrEqual(0);

    // Decode the mapping to verify that line points back to source line 1
    // (the line where the html`` lives).
    const lines = result.map!.mappings.split(';');
    const segs = vlqDecodeLine(lines[compiledLineIdx]);
    expect(segs.length).toBeGreaterThan(0);
    // First segment of a line: [genCol, srcIdx, srcLine, srcCol] — but
    // srcLine/srcCol are *deltas* from the running totals across the whole
    // mappings string, so re-walk from the top.
    let srcLine = 0;
    let srcCol = 0;
    for (let li = 0; li <= compiledLineIdx; li++) {
      const ls = vlqDecodeLine(lines[li]);
      for (const seg of ls) {
        srcLine += seg[2] ?? 0;
        srcCol += seg[3] ?? 0;
      }
      if (li < compiledLineIdx) {
        // Reset deltas tracker — segments encode deltas from prev segment
        // *across* the whole map, but we already walked them. Continue.
      }
    }
    // After consuming through `compiledLineIdx`, srcLine should be the line
    // of the html`` template (line index 1 in the source).
    expect(srcLine).toBe(1);
  });

  it('emits a non-empty mapping when only edits are import rewrites + insertion', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const result = plugin.transform(code, 'app.ts')!;
    expect(result.map!.mappings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Compile error reporting
// ---------------------------------------------------------------------------

describe('@purityjs/vite-plugin compile errors', () => {
  const plugin = purity();

  it('warns with file:line:col when a template fails to compile, leaving source as-is', () => {
    // `<my:component>` parses but fails the codegen SAFE_NAME check.
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<my:component>x</my:component>\`;`;
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: any) => warns.push(String(msg));
    try {
      const result = plugin.transform(code, 'app.ts');
      // No html`` was successfully compiled, so the plugin returns null.
      expect(result).toBeNull();
    } finally {
      console.warn = orig;
    }
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain('app.ts:2:');
    expect(warns[0]).toContain('failed to compile html``');
    expect(warns[0]).toContain('Invalid');
  });

  it('uses plugin context warn() when available', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<my:component>x</my:component>\`;\nconst ok = html\`<p>fine</p>\`;`;
    const ctxWarns: string[] = [];
    const ctx = { warn: (msg: string) => ctxWarns.push(msg) };
    const result = plugin.transform.call(ctx, code, 'app.ts');
    // The valid template still compiles, so the plugin returns a result.
    expect(result).not.toBeNull();
    expect(ctxWarns.length).toBe(1);
    expect(ctxWarns[0]).toContain('app.ts:2:');
  });

  it('still compiles other templates in the same file when one fails', () => {
    const code = `import { html } from '@purityjs/core';\nconst bad = html\`<my:component>x</my:component>\`;\nconst ok = html\`<p>good</p>\`;`;
    const orig = console.warn;
    console.warn = () => {};
    try {
      const result = plugin.transform(code, 'app.ts');
      expect(result).not.toBeNull();
      expect(result!.code).toContain('createElement');
      // The failing template is preserved unchanged in the output.
      expect(result!.code).toContain('html`<my:component>');
    } finally {
      console.warn = orig;
    }
  });

  it('preserves the `html` import when a top-level template fails', () => {
    // The failed template stays as runtime html`` and still needs the import.
    const code = `import { html } from '@purityjs/core';\nconst bad = html\`<my:component>x</my:component>\`;\nconst ok = html\`<p>good</p>\`;`;
    const orig = console.warn;
    console.warn = () => {};
    try {
      const result = plugin.transform(code, 'app.ts')!;
      // Both the original `html` import (kept because of the failure) and the
      // injected watch import should reference @purityjs/core.
      const purityImports = result.code.match(
        /import\s*\{[^}]*\}\s*from\s*['"]@purityjs\/core['"]/g,
      )!;
      expect(purityImports.some((s) => /\bhtml\b/.test(s))).toBe(true);
      expect(purityImports.some((s) => s.includes('__purity_w__'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it('preserves the `html` import when a nested template fails', () => {
    // Outer template compiles, but the inner html`` inside the expression
    // fails its codegen check and is left as runtime code.
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${ok ? html\`<my:component/>\` : ""}</div>\`;`;
    const orig = console.warn;
    console.warn = () => {};
    try {
      const result = plugin.transform(code, 'app.ts')!;
      // The outer template did compile (at least one createElement call).
      expect(result.code).toContain('createElement');
      // The inner failure leaves a runtime html`` in the output…
      expect(result.code).toContain('html`<my:component/>');
      // …so the html import must remain.
      const purityImports = result.code.match(
        /import\s*\{[^}]*\}\s*from\s*['"]@purityjs\/core['"]/g,
      )!;
      expect(purityImports.some((s) => /\bhtml\b/.test(s))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it('warns and preserves the `html` import on a top-level unterminated template', () => {
    // Valid template first so the unterminated one truly has no closing
    // backtick (otherwise the extractor would consume the next `` ` `` as
    // a closer). The valid template should still AOT-compile, and the
    // html import must stay so the unterminated literal still has a
    // runtime tag to call.
    const code = `import { html } from '@purityjs/core';\nconst ok = html\`<p>good</p>\`;\nconst bad = html\`<div>broken`;
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: any) => warns.push(String(msg));
    try {
      const result = plugin.transform(code, 'app.ts')!;
      expect(result).not.toBeNull();
      // Valid template compiled.
      expect(result.code).toContain('createElement');
      // Unterminated template left as runtime html``.
      expect(result.code).toContain('html`<div>broken');
      // html import preserved alongside the watch import.
      const purityImports = result.code.match(
        /import\s*\{[^}]*\}\s*from\s*['"]@purityjs\/core['"]/g,
      )!;
      expect(purityImports.some((s) => /\bhtml\b/.test(s))).toBe(true);
      expect(purityImports.some((s) => s.includes('__purity_w__'))).toBe(true);
      // Warning surfaced with file:line:col.
      expect(warns.some((w) => w.includes('app.ts:3:') && w.includes('unterminated'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  it('reports a nested unterminated template via the outer template warning', () => {
    // Inner html`` is unterminated. Without the fix, the outer template
    // emits `__purity_tpl_0([html\`<broken], __purity_w__)` which is
    // invalid JS. With the fix, compileNestedTemplates throws, the outer
    // catch fires, we warn at the OUTER template's location, and leave
    // the outer html`` in source as runtime code.
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<div>\${html\`<broken}</div>\`;`;
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: any) => warns.push(String(msg));
    try {
      const result = plugin.transform(code, 'app.ts');
      // Either null (no edits) or a result with the html`` left intact.
      // Either way: no crash, a warning, and no `[html\`<broken` invalid JS.
      if (result) {
        expect(result.code).not.toContain('([html`<broken');
        const purityImports = result.code.match(
          /import\s*\{[^}]*\}\s*from\s*['"]@purityjs\/core['"]/g,
        );
        if (purityImports) {
          expect(purityImports.some((s) => /\bhtml\b/.test(s))).toBe(true);
        }
      }
      expect(warns.length).toBeGreaterThan(0);
    } finally {
      console.warn = orig;
    }
  });

  it('is idempotent — re-transforming compiled output is a fixed point', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const first = plugin.transform(code, 'app.ts')!;
    expect(first).not.toBeNull();
    // Compiled output has no `html\`\``, so a second transform must skip
    // (returns null) — proving no double-rewrite of hoists or imports.
    const second = plugin.transform(first.code, 'app.ts');
    expect(second).toBeNull();
  });

  it('handles CRLF line endings without breaking the source map', () => {
    const code = `import { html } from '@purityjs/core';\r\nconst el = html\`<p>x</p>\`;\r\n`;
    const result = plugin.transform(code, 'app.ts');
    expect(result).not.toBeNull();
    expect(result!.code).toContain('createElement');
    // Mapping count should match output newline count regardless of CRLF.
    const newlines = (result!.code.match(/\n/g) ?? []).length;
    const semis = (result!.map!.mappings.match(/;/g) ?? []).length;
    expect(semis).toBe(newlines);
  });

  it('handles a file with no trailing newline', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    expect(code.endsWith('\n')).toBe(false);
    const result = plugin.transform(code, 'app.ts')!;
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
  });

  it('handles non-ASCII characters in template content', () => {
    // Emoji takes two UTF-16 code units in JS strings; column math should
    // still be consistent between source and map.
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>héllo 🌟</p>\`;`;
    const result = plugin.transform(code, 'app.ts')!;
    expect(result).not.toBeNull();
    expect(result.code).toContain('createElement');
    expect(result.map!.sourcesContent[0]).toBe(code);
  });

  it('warning includes both the line and the column of the failing template', () => {
    // 4-space indent puts the html`` at column 18 (1-based) on line 2.
    const code = `import { html } from '@purityjs/core';\n    const bad = html\`<my:component/>\`;`;
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (msg: any) => warns.push(String(msg));
    try {
      plugin.transform(code, 'app.ts');
    } finally {
      console.warn = orig;
    }
    expect(warns.length).toBe(1);
    // line 2, column where html`` starts.
    const expectedCol = '    const bad = '.length + 1; // 1-based
    expect(warns[0]).toContain(`app.ts:2:${expectedCol}`);
  });
});
