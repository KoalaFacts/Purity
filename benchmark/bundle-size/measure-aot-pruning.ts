import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build, type Plugin } from 'vite';
import { purity } from '../../packages/vite-plugin/dist/index.js';

// This focused SV2-015 measurement compares complete client-side AOT payloads.
// Source strings and compression settings are fixed; no files are emitted by Vite.
const root = resolve(import.meta.dirname, '../..');
const entry = resolve(import.meta.dirname, 'aot-pruning-fixture.ts');
const counter = (await readFile(resolve(import.meta.dirname, 'counter.ts'), 'utf8')).replaceAll(
  '\r\n',
  '\n',
);
const fixtures = [
  {
    name: 'static',
    source:
      "import { html } from '@purityjs/core/jit';\nconst root = document.getElementById('app')!;\nroot.append(html`<p>Hello</p>`);\n",
  },
  {
    name: 'event',
    source:
      "import { html } from '@purityjs/core/jit';\nconst root = document.getElementById('app')!;\nconst handler = () => { root.dataset.clicked = 'yes'; };\nroot.append(html`<button @click=${handler}>Tap</button>`);\n",
  },
  {
    name: 'static-mount',
    source:
      "import { html } from '@purityjs/core/jit';\nimport { mount } from '@purityjs/core';\nconst root = document.getElementById('app')!;\nmount(() => html`<p>Hello</p>`, root);\n",
  },
  {
    name: 'event-mount',
    source:
      "import { html } from '@purityjs/core/jit';\nimport { mount } from '@purityjs/core';\nconst root = document.getElementById('app')!;\nconst handler = () => { root.dataset.clicked = 'yes'; };\nmount(() => html`<button @click=${handler}>Tap</button>`, root);\n",
  },
  { name: 'reactive-counter', source: counter },
  { name: 'reactive-counter-prefix-collision', source: `// __purity_comment\n${counter}` },
];

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const packageVersion = async (name: string): Promise<string> => {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  assert.equal(typeof manifest.version, 'string');
  return manifest.version;
};
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const measurements = [];
for (const fixture of fixtures) {
  let transformed = false;
  const input: Plugin = {
    name: 'purity-aot-pruning-input',
    resolveId(id) {
      return id === entry ? entry : null;
    },
    load(id) {
      return id === entry ? fixture.source : null;
    },
  };
  const proof: Plugin = {
    name: 'purity-aot-pruning-transform-proof',
    enforce: 'post',
    transform(code, id) {
      if (resolve(id.split('?')[0]!) !== entry) return;
      transformed = true;
      assert.match(code, /__purity\d*_tpl_/);
      assert.doesNotMatch(code, /html`/);
    },
  };
  const result = await build({
    root,
    configFile: false,
    mode: 'production',
    logLevel: 'silent',
    resolve: { conditions: ['module', 'browser', 'production'] },
    plugins: [input, purity({ strictAot: true, hydratable: false }), proof],
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      modulePreload: false,
      rollupOptions: { input: entry, output: { entryFileNames: 'entry.js' } },
    },
  });
  assert(transformed, `AOT transformation did not run for ${fixture.name}`);
  assert(!Array.isArray(result) && 'output' in result, 'Expected one Vite build output');
  const chunks = result.output.filter((part) => part.type === 'chunk');
  assert.equal(chunks.length, 1, 'A focused fixture must produce one JavaScript chunk');
  assert.equal(chunks.length, result.output.length, 'Unexpected non-JavaScript asset');
  assert.equal(chunks[0].dynamicImports.length, 0, 'A fixture must not hide lazy payload');
  const code = chunks[0].code;
  const bytes = Buffer.from(code);
  const signalRenderedBytes = Object.entries(chunks[0].modules)
    .filter(([id]) => id.replaceAll('\\', '/').includes('/packages/signals/'))
    .reduce((sum, [, info]) => sum + info.renderedLength, 0);
  measurements.push({
    fixture: fixture.name,
    sourceSha256: sha256(fixture.source),
    outputSha256: sha256(bytes),
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
    signalRenderedBytes,
    containsUnsafeUrlValidator: code.includes('Unsafe URL binding'),
  });
}

const report = {
  schemaVersion: 1,
  gap: 'SV2-015',
  revision: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--untracked-files=normal').length > 0,
  node: process.versions.node,
  zlib: process.versions.zlib,
  brotli: process.versions.brotli,
  versions: {
    core: JSON.parse(await readFile(resolve(root, 'packages/core/package.json'), 'utf8')).version,
    plugin: JSON.parse(await readFile(resolve(root, 'packages/vite-plugin/package.json'), 'utf8'))
      .version,
    vite: await packageVersion('vite'),
    parser: await packageVersion('oxc-parser'),
  },
  settings: {
    mode: 'production',
    conditions: ['module', 'browser', 'production'],
    target: 'es2022',
    minify: true,
    gzipLevel: 9,
    brotliQuality: 11,
    hydratable: false,
  },
  measurements,
};
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--out'), 'Use --out <file>');
const json = `${JSON.stringify(report, null, 2)}\n`;
if (args.length === 2) await writeFile(args[1]!, json, 'utf8');
else process.stdout.write(json);
