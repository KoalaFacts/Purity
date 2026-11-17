// @vitest-environment jsdom
import { resolve } from 'node:path';
import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';
import { build, type Plugin } from 'vite';
import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

const entry = resolve(import.meta.dirname, '../../../benchmark/bundle-size/late-import-fixture.ts');

async function bundle(source: string, ssr: boolean): Promise<string> {
  const fixture: Plugin = {
    name: 'late-import-fixture',
    resolveId: (id) => (id === entry ? entry : undefined),
    load: (id) => (id === entry ? source : undefined),
  };
  const output = await build({
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
      rollupOptions: {
        input: entry,
        preserveEntrySignatures: 'strict',
        output: { entryFileNames: 'entry.js', codeSplitting: false },
      },
    },
  });
  if (Array.isArray(output) || !('output' in output)) throw new Error('Expected one output');
  const chunks = output.output.filter((part) => part.type === 'chunk');
  expect(chunks).toHaveLength(1);
  return chunks[0].code;
}

describe('AOT templates before late imports', () => {
  it('runs a top-level client template before a later import in a production ESM bundle', async () => {
    const code = await bundle(
      `import { html } from '@purityjs/core/jit';
       export const first = html\`<p>Hello</p>\`;
       import { state } from '@purityjs/signals';
       export const later = state('ready');`,
      false,
    );
    const app = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    const root = document.createElement('div');
    root.append(app.first);
    expect(root.innerHTML).toBe('<p>Hello</p>');
    expect(app.later()).toBe('ready');
  }, 30000);

  it('runs a top-level SSR template before a later import in a production ESM bundle', async () => {
    const code = await bundle(
      `import { html } from '@purityjs/core/jit';
       export const first = html\`<p>Hello</p>\`;
       import { renderToString } from '@purityjs/ssr';
       export const later = () => renderToString(() => first);`,
      true,
    );
    const app = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    expect(await app.later()).toBe('<p>Hello</p>');
  }, 30000);

  it.each([false, true])('preserves directives, comments, and source maps with SSR=%s', (ssr) => {
    const source = `'use client';
import { html } from '@purityjs/core/jit'; // early import
// comment before first statement
export const first = html\`<p>🌏</p>\`;
// comment before later import
import { state } from '@purityjs/signals'; // late import
export const tail = state('ok');`;
    const result = purity().transform(source, 'late-import.ts', { ssr });
    expect(result).not.toBeNull();
    expect(result!.code.trimStart().startsWith("'use client';")).toBe(true);
    expect(result!.code).toContain('// comment before first statement\nexport const first =');
    expect(result!.code).toContain('// comment before later import\nimport { state }');
    expect(result!.code).toContain('// late import');
    const lines = result!.code.split('\n');
    const line = lines.findIndex((text) => text.includes("export const tail = state('ok');")) + 1;
    expect(line).toBeGreaterThan(0);
    const map = new SourceMapConsumer(result!.map as unknown as RawSourceMap);
    expect(map.originalPositionFor({ line, column: 0 }).line).toBe(7);
    expect(result!.map!.sourcesContent).toEqual([source]);
  });

  it.each([false, true])(
    'preserves a hashbang and directive without imports with SSR=%s',
    (ssr) => {
      const source = `#!/usr/bin/env node
'use client'; // keep directive comment
// @__PURE__
const unused = call();
export const first = html\`<p>Hello</p>\`;`;
      const result = purity().transform(source, 'hashbang.js', { ssr });
      expect(result).not.toBeNull();
      expect(
        result!.code.startsWith("#!/usr/bin/env node\n'use client'; // keep directive comment"),
      ).toBe(true);
      expect(result!.code).toContain('// @__PURE__\nconst unused = call();');
    },
  );
});
