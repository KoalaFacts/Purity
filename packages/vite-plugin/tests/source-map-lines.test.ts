import { describe, expect, it, vi } from 'vite-plus/test';
import { SourceMapConsumer } from 'source-map-js';
import { purity } from '../src/index.ts';

const separators = [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
  ['CR', '\r'],
  ['LS', '\u2028'],
  ['PS', '\u2029'],
] as const;
const lines = (text: string) => text.split(/\r\n|[\r\n\u2028\u2029]/);

for (const ssr of [false, true]) {
  describe(`${ssr ? 'SSR' : 'client'} AOT source positions`, () => {
    for (const [name, separator] of separators) {
      it(`maps unchanged statements and compiled templates with ${name} separators`, () => {
        const source = [
          "import { html } from '@purityjs/core/jit';",
          'const message = "🌟";',
          'const view = html`<p>${message}</p>`;',
          'throw new Error(message);',
        ].join(separator);
        const result = purity().transform(source, '/app.ts', { ssr })!;
        const map = new SourceMapConsumer(result.map);
        const outputLines = lines(result.code);
        const diagnosticLine = outputLines.findIndex((line) => line.startsWith('throw new Error'));
        expect(map.originalPositionFor({ line: diagnosticLine + 1, column: 0 })).toMatchObject({
          source: '/app.ts',
          line: 4,
          column: 0,
        });
        const templateLine = outputLines.findIndex((line) => line.startsWith('const view ='));
        expect(
          map.originalPositionFor({ line: templateLine + 1, column: 'const view = '.length }),
        ).toMatchObject({ source: '/app.ts', line: 3, column: 'const view = '.length });
        expect(result.map.mappings.split(';')).toHaveLength(outputLines.length);
        expect(result.map.sourcesContent).toEqual([source]);
        expect(result.code).toContain(separator + 'throw new Error(message);');
      });

      it(`reports the original warning line and UTF-16 column with ${name} separators`, () => {
        const source = [
          "import { html } from '@purityjs/core/jit';",
          'const marker = "🌟"; const bad = html`<my:component/>`;',
        ].join(separator);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          expect(purity().transform(source, '/warn.ts', { ssr })).toBeNull();
          expect(warn).toHaveBeenCalledTimes(1);
          const column = 'const marker = "🌟"; const bad = '.length + 1;
          expect(warn.mock.calls[0]![0]).toContain(`/warn.ts:2:${column}`);
        } finally {
          warn.mockRestore();
        }
      });

      it(`maps text after a generated slot expression containing ${name}`, () => {
        const expression = `(() => {${separator}return 'value';${separator}})()`;
        const source =
          "import { html } from '@purityjs/core/jit';\n" +
          `const view = html\`<p>\${${expression}}</p>\`;\n` +
          'throw new Error("after slot");';
        const result = purity().transform(source, '/slot.ts', { ssr })!;
        const outputLines = lines(result.code);
        const line = outputLines.findIndex((text) => text.startsWith('throw new Error')) + 1;
        expect(
          new SourceMapConsumer(result.map).originalPositionFor({ line, column: 0 }),
        ).toMatchObject({
          source: '/slot.ts',
          line: 5,
          column: 0,
        });
        expect(result.code).toContain(expression);
        expect(result.map.mappings.split(';')).toHaveLength(outputLines.length);
      });
    }
  });
}
