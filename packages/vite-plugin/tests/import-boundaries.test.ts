import { describe, expect, it } from 'vite-plus/test';
import { parseSync } from 'oxc-parser';
import { SourceMapConsumer } from 'source-map-js';
import { purity } from '../src/index.ts';

for (const ssr of [false, true]) {
  describe(`${ssr ? 'SSR' : 'client'} AOT import boundaries`, () => {
    for (const entry of ['@purityjs/core/jit', '@purityjs/ssr']) {
      const fake = `import { html } from '${entry}';`;
      for (const [name, snippet] of [
        ['string', `const payload = ${JSON.stringify(fake)};`],
        ['template', 'const payload = `\n' + fake + '\n`;'],
        ['block comment', '/*\n' + fake + '\n*/'],
        ['line comment', '// ' + fake],
        ['other tagged template', 'const payload = String.raw`\n' + fake + '\n`;'],
      ]) {
        it(`preserves import text in ${name} (${entry})`, () => {
          const source = `import { html } from '${entry}';\n${snippet}\nconst view = html\`<p>real</p>\`;`;
          const result = purity({ hydratable: true, strictAot: false }).transform(
            source,
            'app.ts',
            { ssr },
          );
          expect(result).not.toBeNull();
          expect(result!.code).toContain(snippet);
          const parsed = parseSync('app.ts', result!.code);
          expect(parsed.errors).toEqual([]);
          expect(
            parsed.program.body.some(
              (node) =>
                node.type === 'ImportDeclaration' &&
                node.specifiers.some((specifier) => specifier.local.name === 'html'),
            ),
          ).toBe(false);
        });
      }
    }

    for (const clause of [
      '{ html /* a comma, a brace } and import text */ , other as keep }',
      '{ other as keep, /* before */ html /* after */, }',
      '{ html as html, other as keep }',
      'fallback, { html, other as keep }',
      'fallback, { /* before */ html /* after */, }',
      '{ type HTML, html, other as keep }',
      '{ html, html as retained }',
    ]) {
      it(`removes only the compiled binding from ${clause}`, () => {
        const source = `import ${clause} from '@purityjs/core/jit';\nconst view = html\`<p>real</p>\`;`;
        const result = purity({ hydratable: true, strictAot: false }).transform(source, 'app.ts', {
          ssr,
        });
        const parsed = parseSync('app.ts', result!.code);
        expect(parsed.errors).toEqual([]);
        const imports = parsed.program.body.filter(
          (node) => node.type === 'ImportDeclaration' && node.source.value === '@purityjs/core/jit',
        );
        const names = imports.flatMap((node) =>
          node.specifiers.map((specifier) => specifier.local.name),
        );
        expect(names).not.toContain('html');
        for (const name of ['keep', 'fallback', 'HTML', 'retained']) {
          expect(names.includes(name)).toBe(clause.includes(name));
        }
      });
    }

    for (const separator of ['\r', '\u2028', '\u2029']) {
      for (const clause of [
        `{ html // comment${separator}, other as keep }`,
        `fallback, { html // comment${separator} }`,
      ]) {
        it(`handles line-comment terminator ${JSON.stringify(separator)} in ${clause}`, () => {
          const source = `import ${clause} from '@purityjs/core/jit';\nconst view = html\`<p>real</p>\`;`;
          const result = purity({ hydratable: true, strictAot: false }).transform(
            source,
            'app.ts',
            { ssr },
          );
          const parsed = parseSync('app.ts', result!.code);
          expect(parsed.errors).toEqual([]);
          expect(result!.code).toContain('const view =');
          const names = parsed.program.body.flatMap((node) =>
            node.type === 'ImportDeclaration' && node.source.value === '@purityjs/core/jit'
              ? node.specifiers.map((specifier) => specifier.local.name)
              : [],
          );
          expect(names).toEqual(clause.startsWith('fallback') ? ['fallback'] : ['keep']);
        });
      }
    }

    it('keeps the next statement annotation attached to its call', () => {
      const annotation = '/* @__PURE__ */ doWork();';
      const source = `import { html } from '@purityjs/core/jit';\n${annotation}\nconst view = html\`<p>real</p>\`;`;
      const result = purity({ hydratable: true, strictAot: false }).transform(source, 'app.ts', {
        ssr,
      });
      expect(result!.code).toContain(annotation);
    });

    it('keeps a leading line PURE annotation when the module has no imports', () => {
      const annotation = '// @__PURE__\ndoWork();';
      const source = `${annotation}\nconst view = html\`<p>real</p>\`;`;
      const result = purity({ hydratable: true, strictAot: false }).transform(source, 'app.ts', {
        ssr,
      });
      expect(result!.code).toContain(annotation);
    });

    it('preserves source mapping after literal import text and Unicode', () => {
      const source =
        "import { html } from '@purityjs/core/jit';\nconst message = \"🌟 import { html } from '@purityjs/core/jit';\";\nconst view = html`<p>real</p>`;\nthrow new Error(message);";
      const result = purity({ hydratable: true, strictAot: false }).transform(source, 'app.ts', {
        ssr,
      });
      const lines = result!.code.split('\n');
      const line = lines.findIndex((text) => text.includes('throw new Error(message)')) + 1;
      const map = new SourceMapConsumer(result!.map);
      expect(map.originalPositionFor({ line, column: 0 }).line).toBe(4);
      expect(result!.map.sourcesContent).toEqual([source]);
    });
  });
}
