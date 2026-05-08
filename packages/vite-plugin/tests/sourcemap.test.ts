// Verify the hand-rolled v3 source map is consumable by a real source-map
// library and that it correctly maps known compiled positions back to the
// original `html\`\`` location in user source.

import { SourceMapConsumer } from 'source-map-js';
import { describe, expect, it } from 'vitest';
import { purity } from '../src/index.ts';

const plugin = purity();

function transform(code: string, id = 'app.ts') {
  const r = plugin.transform(code, id);
  if (!r) throw new Error('plugin returned null');
  return r;
}

function findInOutput(out: string, needle: string): { line: number; column: number } {
  // Returns 1-based line and 0-based column (source-map-js convention).
  const idx = out.indexOf(needle);
  if (idx === -1) throw new Error(`needle ${JSON.stringify(needle)} not found`);
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < idx; i++) {
    if (out.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, column: idx - lastNl - 1 };
}

describe('source map round-trip via source-map-js', () => {
  it('maps the compiled call back to the original html`` line', () => {
    const code =
      `import { html } from '@purityjs/core';\n` + // line 1
      `const a = 1;\n` + // line 2
      `const el = html\`<div>x</div>\`;`; // line 3
    const r = transform(code);
    const consumer = new SourceMapConsumer(r.map!);

    const { line, column } = findInOutput(r.code, '__purity_tpl_0([');
    const orig = consumer.originalPositionFor({ line, column });
    expect(orig.source).toBe('app.ts');
    // The html`` on line 3 of source maps the compiled call back to line 3.
    expect(orig.line).toBe(3);
  });

  it('maps unchanged source lines line-for-line', () => {
    const code =
      `import { html } from '@purityjs/core';\n` + // line 1
      `// keep this comment\n` + // line 2
      `const x = 42;\n` + // line 3
      `const el = html\`<p>x</p>\`;`; // line 4
    const r = transform(code);
    const consumer = new SourceMapConsumer(r.map!);

    // The user's `// keep this comment` line should appear in the output and
    // map back to source line 2.
    const { line, column } = findInOutput(r.code, '// keep this comment');
    const orig = consumer.originalPositionFor({ line, column });
    expect(orig.source).toBe('app.ts');
    expect(orig.line).toBe(2);
  });

  it('maps the user line `const x = 42` back to its source line', () => {
    const code =
      `import { html } from '@purityjs/core';\n` + // line 1
      `const x = 42;\n` + // line 2
      `const el = html\`<p>\${x}</p>\`;`; // line 3
    const r = transform(code);
    const consumer = new SourceMapConsumer(r.map!);

    const { line, column } = findInOutput(r.code, 'const x = 42;');
    const orig = consumer.originalPositionFor({ line, column });
    expect(orig.source).toBe('app.ts');
    expect(orig.line).toBe(2);
  });

  it('sourcesContent is preserved verbatim', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const r = transform(code);
    expect(r.map!.sourcesContent[0]).toBe(code);
    expect(r.map!.sources).toEqual(['app.ts']);
  });

  it('gracefully handles a query for a position past the end of the map', () => {
    const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>x</p>\`;`;
    const r = transform(code);
    const consumer = new SourceMapConsumer(r.map!);
    // Line 9999 is way past the output — consumer should return null fields,
    // not throw.
    const orig = consumer.originalPositionFor({ line: 9999, column: 0 });
    expect(orig.source).toBeNull();
  });
});
