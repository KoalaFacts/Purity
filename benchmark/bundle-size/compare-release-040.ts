import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build, type Plugin } from 'vite';
import { chromium, firefox, webkit } from 'playwright';
import { purity as currentPlugin } from '../../packages/vite-plugin/dist/index.js';

// Install the published packages in this ignored directory before measuring.
const root = resolve(import.meta.dirname, '../..');
const baselineRoot = resolve(root, 'benchmark/dist/release-040');
const baselinePluginPath = resolve(
  baselineRoot,
  'node_modules/@purityjs/vite-plugin/dist/index.js',
);
const { purity: baselinePlugin } = await import(pathToFileURL(baselinePluginPath).href);
const fixtureNames = ['counter.ts', 'controls.ts', 'controls-view.ts', 'resource.ts'];
const sources = Object.fromEntries(
  await Promise.all(
    fixtureNames.map(async (name) => [
      name,
      await readFile(join(import.meta.dirname, name), 'utf8'),
    ]),
  ),
);
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fixtureHashes = Object.fromEntries(fixtureNames.map((name) => [name, sha(sources[name])]));
const results = [];
const payloads = new Map<string, string>();
for (const version of ['0.4.0', 'current'] as const) {
  for (const profile of ['counter', 'controls', 'resource'] as const) {
    for (const mode of ['jit', 'aot', 'client-aot'] as const) {
      if (version === '0.4.0' && mode === 'client-aot') continue;
      const buildRoot = version === '0.4.0' ? baselineRoot : root;
      const entry = join(buildRoot, 'benchmark-fixture', `${profile}.ts`);
      const view = join(buildRoot, 'benchmark-fixture', 'controls-view.ts');
      let transformed = false;
      const input: Plugin = {
        name: 'release-comparison-input',
        resolveId(id, importer) {
          if (id === entry) return entry;
          if (id === './controls-view.ts' && importer === entry) return view;
        },
        load(id) {
          if (id === entry) return sources[`${profile}.ts`];
          if (id === view) return sources['controls-view.ts'];
        },
      };
      const proof: Plugin = {
        name: 'release-comparison-proof',
        enforce: 'post',
        transform(code, id) {
          if (id !== (profile === 'controls' ? view : entry)) return;
          transformed = true;
          assert.equal(/html`/.test(code), mode === 'jit', 'Unexpected template compilation');
        },
      };
      const output = await build({
        root: buildRoot,
        configFile: false,
        mode: 'production',
        logLevel: 'silent',
        resolve: { conditions: ['module', 'browser', 'production'] },
        plugins: [
          input,
          ...(mode !== 'jit'
            ? [
                version === '0.4.0'
                  ? baselinePlugin()
                  : currentPlugin({ hydratable: mode === 'aot' }),
              ]
            : []),
          proof,
        ],
        build: { write: false, target: 'es2022', minify: true, rollupOptions: { input: entry } },
      });
      assert(transformed);
      assert(!Array.isArray(output) && 'output' in output);
      const chunks = output.output.filter((part) => part.type === 'chunk');
      assert.equal(chunks.length, 1);
      assert.equal(chunks.length, output.output.length);
      assert.equal(chunks[0].dynamicImports.length, 0);
      const bytes = Buffer.from(chunks[0].code);
      payloads.set(`${version}:${profile}:${mode}`, chunks[0].code);
      results.push({
        version,
        profile,
        mode,
        outputSha256: sha(bytes),
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 9 }).length,
        brotliBytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
          .length,
      });
    }
  }
}
const args = process.argv.slice(2);
assert(
  args.every((arg, index) => arg === '--verify' || arg === '--out' || args[index - 1] === '--out'),
);
const verification: Record<string, string> = {};
if (args.includes('--verify')) {
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch();
    try {
      for (const [name, code] of payloads) {
        const page = await browser.newPage();
        try {
          await page.setContent('<div id="app"></div>');
          await page.addScriptTag({ content: code, type: 'module' });
          if (name.includes(':counter:')) {
            await page.getByRole('button').click();
            await page.waitForFunction(() =>
              document.querySelector('button')?.textContent?.includes('Count: 1'),
            );
          } else if (name.includes(':controls:')) {
            await page.getByRole('button', { name: 'Reverse rows' }).click();
            await page.waitForFunction(() => document.querySelector('li')?.textContent === 'Gamma');
            await page.getByRole('button', { name: 'Toggle details' }).click();
            await page.getByText('Details visible').waitFor();
          } else {
            await page.getByText('Load 1', { exact: true }).waitFor();
            await page.getByRole('button', { name: 'Reload' }).click();
            await page.getByText('Load 2', { exact: true }).waitFor();
            await page.getByRole('button', { name: 'Save' }).click();
            await page.getByText('Saved Ada', { exact: true }).waitFor();
          }
        } finally {
          await page.close();
        }
      }
      verification[engine.name()] = browser.version();
    } finally {
      await browser.close();
    }
  }
}
const lock = JSON.parse(await readFile(join(baselineRoot, 'package-lock.json'), 'utf8'));
const vite = JSON.parse(await readFile(join(root, 'node_modules/vite/package.json'), 'utf8'));
const parser = JSON.parse(
  await readFile(join(root, 'node_modules/oxc-parser/package.json'), 'utf8'),
);
const report = {
  schemaVersion: 1,
  gap: 'SV2-015',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  ),
  node: process.versions.node,
  zlib: process.versions.zlib,
  brotli: process.versions.brotli,
  versions: { vite: vite.version, parser: parser.version },
  baselinePackages: Object.fromEntries(
    ['@purityjs/core', '@purityjs/vite-plugin'].map((name) => [
      name,
      lock.packages[`node_modules/${name}`],
    ]),
  ),
  fixtureHashes,
  verification: args.includes('--verify')
    ? { status: 'passed', engines: verification }
    : { status: 'not-run' },
  settings: {
    target: 'es2022',
    mode: 'production',
    gzipLevel: 9,
    brotliQuality: 11,
    currentAotHydratable: true,
    currentClientAotHydratable: false,
  },
  results,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
const outputIndex = args.indexOf('--out');
if (outputIndex !== -1) {
  assert(args[outputIndex + 1]);
  await writeFile(args[outputIndex + 1], json);
} else process.stdout.write(json);
