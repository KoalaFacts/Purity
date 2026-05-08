// Property-based fuzz on the plugin transform. Goal: prove the plugin
// never crashes (uncaught throw) and produces a valid result shape for
// any input we'd plausibly accept.
//
// Inputs are intentionally narrow: Purity's runtime template parser can be
// pathologically slow on adversarial HTML, and the goal here is to stress
// the *plugin* (extractor, brace counting, import scanning), not the core
// parser. Crashes there are tracked under the @purityjs/core suite.

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { purity } from '../src/index.ts';

const plugin = purity();

// Keep static parts limited to characters that won't trip the parser.
const safeStatic = fc.stringMatching(/^[a-z0-9 ]{0,20}$/);

const safeExpr = fc.constantFrom(
  'x',
  '1 + 2',
  "'hi'",
  '() => 42',
  '{ a: 1 }',
  '[1, 2, 3]',
  'foo()',
);

describe('plugin fuzz — never crashes on accepted input', () => {
  it('safe template shapes always produce a valid result or null', () => {
    fc.assert(
      fc.property(
        fc.tuple(safeStatic, fc.array(fc.tuple(safeExpr, safeStatic), { maxLength: 3 })),
        ([head, parts]) => {
          const tpl =
            'html`<div>' + head + parts.map(([e, s]) => '${' + e + '}' + s).join('') + '</div>`';
          const code = `import { html } from '@purityjs/core';\nconst el = ${tpl};`;
          const orig = console.warn;
          console.warn = () => {};
          try {
            const r = plugin.transform(code, 'app.ts');
            if (r === null) return true;
            return typeof r.code === 'string' && typeof r.map === 'object';
          } finally {
            console.warn = orig;
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('arbitrary unrelated source (no html``) returns null', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (s) => {
        if (s.includes('html`')) return true; // not the case under test
        return plugin.transform(s, 'app.ts') === null;
      }),
      { numRuns: 50 },
    );
  });

  it('plugin never throws on tiny random html`` content', () => {
    // Stress the *plugin* (extractor + import scanner), not the core
    // parser — adversarial HTML can be slow in the parser itself, which
    // is tested separately. Limit junk to plain-text characters.
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9 ]{0,15}$/), (junk) => {
        const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>${junk}</p>\`;`;
        const orig = console.warn;
        console.warn = () => {};
        try {
          plugin.transform(code, 'app.ts');
          return true;
        } catch {
          return false;
        } finally {
          console.warn = orig;
        }
      }),
      { numRuns: 50 },
    );
  });

  it('extractor handles balanced braces in expressions deterministically', () => {
    // Generate balanced brace strings and assert the plugin handles them.
    const balanced = fc.letrec((tie) => ({
      braces: fc.oneof(
        { maxDepth: 3 },
        fc.constant(''),
        fc.tuple(tie('braces'), tie('braces')).map(([a, b]) => `${a}${b}`),
        tie('braces').map((s: string) => `{${s}}`),
      ),
    })).braces as fc.Arbitrary<string>;

    fc.assert(
      fc.property(balanced, (b) => {
        const code = `import { html } from '@purityjs/core';\nconst el = html\`<p>\${(${b || 'null'})}</p>\`;`;
        const orig = console.warn;
        console.warn = () => {};
        try {
          const r = plugin.transform(code, 'app.ts');
          // Either the plugin compiled it (most cases) or returned null.
          if (r !== null) {
            expect(typeof r.code).toBe('string');
          }
          return true;
        } finally {
          console.warn = orig;
        }
      }),
      { numRuns: 30 },
    );
  });
});
