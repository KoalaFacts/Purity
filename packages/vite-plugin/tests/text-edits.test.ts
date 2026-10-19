import { SourceMapConsumer } from 'source-map-js';
import { expect, it } from 'vite-plus/test';
import { applyEdits, buildLineStarts, emptyV3Map, offsetToLineCol } from '../src/text-edits.ts';

const boundaries = ['', 'x', '🌟', '\r', '\n', '\r\n', '\u2028', '\u2029'];
const lines = (text: string) => text.split(/\r\n|[\r\n\u2028\u2029]/);
const position = (text: string, offset: number) => {
  const before = lines(text.slice(0, offset));
  return { line: before.length, column: before[before.length - 1].length };
};

it.each(boundaries)('preserves replacement and marker mapping after prefix %j', (left) => {
  for (const inserted of boundaries) {
    for (const right of boundaries) {
      const source = left + 'DELETE' + right + 'MARKER';
      for (const separate of [false, true]) {
        const edits = separate
          ? [
              { start: left.length, end: left.length + 3, out: inserted },
              { start: left.length + 3, end: left.length + 6, out: '' },
            ]
          : [{ start: left.length, end: left.length + 6, out: inserted }];
        // An empty edit gives the unchanged marker its own mapping segment.
        edits.push({ start: source.length - 6, end: source.length - 6, out: '' });
        const result = applyEdits(source, edits, buildLineStarts(source), '/test.ts');
        expect(result.code).toBe(left + inserted + right + 'MARKER');
        expect(result.map.mappings.split(';')).toHaveLength(lines(result.code).length);
        const actual = new SourceMapConsumer(result.map).originalPositionFor(
          position(result.code, result.code.indexOf('MARKER')),
        );
        expect({ line: actual.line, column: actual.column }).toEqual(
          position(source, source.indexOf('MARKER')),
        );
      }
    }
  }
});

it('uses UTF-16 columns and treats CRLF as one line in diagnostics', () => {
  const source = '🌟x\r\ny\rz\u2028q\u2029';
  const starts = buildLineStarts(source);
  expect(starts).toEqual([0, 5, 7, 9, 11]);
  expect(offsetToLineCol(starts, 2)).toEqual({ line: 0, column: 2 });
  expect(offsetToLineCol(starts, 5)).toEqual({ line: 1, column: 0 });
  expect(offsetToLineCol(starts, source.length)).toEqual({ line: 4, column: 0 });
});

it('retains the original source without inventing identity mappings for rewrites', () => {
  expect(emptyV3Map('/original.ts', 'original')).toEqual({
    version: 3,
    sources: ['/original.ts'],
    sourcesContent: ['original'],
    names: [],
    mappings: '',
  });
});
