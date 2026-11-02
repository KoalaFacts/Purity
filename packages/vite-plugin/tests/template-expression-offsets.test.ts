// @vitest-environment jsdom
import { resolve } from 'node:path';
import { SourceMapConsumer } from 'source-map-js';
import { build, type Plugin } from 'vite';
import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

const sourceFor = (ssr: boolean) =>
  [
    "import { html } from '@purityjs/core/jit';",
    ssr ? "import { renderToString } from '@purityjs/ssr';" : '// client-only fixture',
    'export const view = (a, b) => html`<main><p>🌏${ /* keep slot */ (a, b) }</p><span>${html`<b>${b}</b>`}</span><i>${ `${a}:${b}` }</i><u>${a, b}</u><small>${((x) => ({value: x}))(b).value}</small></main>`;',
    ssr
      ? 'export const render = () => renderToString(() => view("left", "right"));'
      : '// no SSR renderer',
    "export const tail = '🌟';",
    'export const asyncView = async (promise) => html`<em>${await promise}</em>`;',
    'export function* generatorView() { return html`<em>${yield "prompt"}</em>`; }',
    ssr
      ? 'export const renderPart = (value) => renderToString(() => value);'
      : '// no SSR renderPart',
  ].join('\n');

async function bundle(ext: string, ssr: boolean): Promise<string> {
  const entry = resolve(
    import.meta.dirname,
    `../../../benchmark/bundle-size/expression-offsets.${ext}`,
  );
  const source = sourceFor(ssr);
  const fixture: Plugin = {
    name: 'template-expression-offsets',
    resolveId: (id) => (id === entry ? entry : undefined),
    load: (id) => (id === entry ? source : undefined),
  };
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    resolve: { conditions: ['module', ssr ? 'node' : 'browser', 'production'] },
    ...(ssr ? { ssr: { noExternal: true } } : {}),
    plugins: [fixture, purity()],
    build: {
      ...(ssr ? { ssr: true } : {}),
      write: false,
      target: 'es2022',
      minify: true,
      rollupOptions: { input: entry, preserveEntrySignatures: 'strict' },
    },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one build output');
  const chunks = result.output.filter((part) => part.type === 'chunk');
  expect(chunks).toHaveLength(1);
  return chunks[0].code;
}

describe('template expressions in JavaScript and TypeScript modules', () => {
  it.each(
    ['js', 'jsx', 'ts', 'tsx'].flatMap((ext) => [false, true].map((ssr) => [ext, ssr] as const)),
  )(
    'preserves multiple and nested expressions in %s with SSR=%s',
    async (ext, ssr) => {
      const source = sourceFor(ssr);
      const result = purity().transform(source, `fixture.${ext}`, { ssr });
      expect(result).not.toBeNull();
      expect(result!.code).toContain('/* keep slot */ (a, b)');
      expect(result!.map.sourcesContent).toEqual([source]);
      const outputLines = result!.code.split('\n');
      const generatedLine =
        outputLines.findIndex((line) => line.includes("export const tail = '🌟'")) + 1;
      expect(generatedLine).toBeGreaterThan(0);
      expect(
        new SourceMapConsumer(result!.map).originalPositionFor({ line: generatedLine, column: 0 })
          .line,
      ).toBe(5);

      const code = await bundle(ext, ssr);
      const app = await import(
        `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
      );
      const host = document.createElement('div');
      if (ssr) host.innerHTML = await app.render();
      else host.append(app.view('left', 'right'));
      expect(host.querySelector('p')?.textContent).toBe('🌏right');
      expect(host.querySelector('span b')?.textContent).toBe('right');
      expect(host.querySelector('i')?.textContent).toBe('left:right');
      expect(host.querySelector('u')?.textContent).toBe('right');
      expect(host.querySelector('small')?.textContent).toBe('right');
      expect(app.tail).toBe('🌟');

      const awaited = await app.asyncView(Promise.resolve('awaited'));
      const generator = app.generatorView();
      expect(generator.next().value).toBe('prompt');
      const yielded = generator.next('yielded').value;
      for (const [value, expected] of [
        [awaited, 'awaited'],
        [yielded, 'yielded'],
      ]) {
        host.replaceChildren();
        if (ssr) host.innerHTML = await app.renderPart(value);
        else host.append(value);
        expect(host.querySelector('em')?.textContent).toBe(expected);
      }
    },
    30000,
  );
});
