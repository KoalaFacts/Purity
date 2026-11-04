import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { chromium, firefox, webkit } from 'playwright';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '../..');
const baselineRoot = resolve(root, 'benchmark/dist/release-040');
const currentRootIndex = process.argv.indexOf('--current-root');
if (currentRootIndex !== -1) assert(process.argv[currentRootIndex + 1]);
const currentRoot = currentRootIndex === -1 ? root : resolve(process.argv[currentRootIndex + 1]!);
const outputs: Array<{
  version: string;
  code: string;
  exports: string[];
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  sha256: string;
}> = [];
for (const version of ['0.4.0', 'current'] as const) {
  const buildRoot = version === '0.4.0' ? baselineRoot : currentRoot;
  const entry = resolve(buildRoot, 'bundle-api-fixture.js').replaceAll('\\', '/');
  const source = "export * from '@purityjs/core';";
  const built = await build({
    root: buildRoot,
    configFile: false,
    mode: 'production',
    logLevel: 'silent',
    resolve: { conditions: ['module', 'browser', 'production'] },
    plugins: [
      {
        name: 'public-api-comparison-input',
        resolveId(id) {
          if (id === entry) return entry;
        },
        load(id) {
          if (id === entry) return source;
        },
      },
    ],
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      rollupOptions: { input: entry, preserveEntrySignatures: 'strict' },
    },
  });
  assert(!Array.isArray(built));
  const chunks = built.output.filter((item) => item.type === 'chunk');
  assert.equal(chunks.length, 1);
  assert.equal(built.output.length, 1);
  assert.equal(chunks[0].imports.length, 0);
  assert.equal(chunks[0].dynamicImports.length, 0);
  if (version === 'current' && currentRoot !== root) {
    const moduleIds = Object.keys(chunks[0].modules).map((id) => id.replaceAll('\\', '/'));
    assert(
      moduleIds.some((id) => id.includes('/node_modules/@purityjs/core/')) &&
        moduleIds.some((id) => id.includes('/node_modules/@purityjs/signals/')),
      'Packed consumer must resolve core and signals from installed packages',
    );
    assert(
      !moduleIds.some((id) => /\/packages\/(core|signals|compiler)\//.test(id)),
      'Packed consumer unexpectedly resolved workspace sources',
    );
  }
  const bytes = Buffer.from(chunks[0].code);
  outputs.push({
    version,
    code: chunks[0].code,
    exports: [...chunks[0].exports].sort(),
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    brotliBytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
      .length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
assert.deepEqual(outputs[0].exports, outputs[1].exports, 'Public export sets differ');
const engines: Record<string, string> = {};
const shouldVerify =
  process.argv.includes('--verify') ||
  (process.argv.includes('--require-50') &&
    outputs[1].gzipBytes <= Math.floor(outputs[0].gzipBytes / 2));
if (shouldVerify) {
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch();
    try {
      for (const output of outputs) {
        const page = await browser.newPage();
        try {
          await page.setContent('<div id="app"></div>');
          const actual = await page.evaluate(async (code) => {
            const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
            try {
              const api = await import(url);
              const value = api.state(1);
              const seen: number[] = [];
              const stop = api.watch(() => {
                seen.push(value());
              });
              value(2);
              await Promise.resolve();
              stop();
              value(3);
              await Promise.resolve();
              const result = api.mount(
                () => document.createElement('p'),
                document.getElementById('app'),
              );
              const mounted = document.querySelectorAll('#app p').length;
              result.unmount();
              api.component(
                'bundle-api-form-probe',
                () => {
                  const input = document.createElement('input');
                  input.value = 'preserved';
                  return input;
                },
                { formControl: true },
              );
              const form = document.createElement('form');
              const host = document.createElement('bundle-api-form-probe');
              host.setAttribute('name', 'field');
              form.appendChild(host);
              document.body.appendChild(form);
              const formValue = new FormData(form).get('field');
              form.remove();
              return {
                seen,
                mounted,
                remaining: document.querySelectorAll('#app p').length,
                formValue,
              };
            } finally {
              URL.revokeObjectURL(url);
            }
          }, output.code);
          assert.deepEqual(actual, {
            seen: [1, 2],
            mounted: 1,
            remaining: 0,
            formValue: 'preserved',
          });
        } finally {
          await page.close();
        }
      }
      engines[engine.name()] = browser.version();
    } finally {
      await browser.close();
    }
  }
}
const lock = JSON.parse(await readFile(resolve(baselineRoot, 'package-lock.json'), 'utf8'));
const installedLock =
  currentRoot === root
    ? null
    : JSON.parse(await readFile(resolve(currentRoot, 'node_modules/.package-lock.json'), 'utf8'));
const report = {
  gap: 'SV2-015',
  node: process.versions.node,
  baselinePackage: lock.packages['node_modules/@purityjs/core'],
  currentInstalledIntegrities: installedLock
    ? Object.fromEntries(
        ['@purityjs/core', '@purityjs/signals', '@purityjs/compiler'].map((name) => [
          name,
          installedLock.packages[`node_modules/${name}`]?.integrity,
        ]),
      )
    : null,
  settings: { target: 'es2022', gzipLevel: 9, brotliQuality: 11 },
  verification: shouldVerify ? { status: 'passed', engines } : { status: 'not-run' },
  results: outputs.map(({ code: _code, ...result }) => result),
};
const index = process.argv.indexOf('--out');
if (index !== -1) {
  assert(process.argv[index + 1]);
  await writeFile(process.argv[index + 1], `${JSON.stringify(report, null, 2)}\n`);
} else console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--require-50')) {
  const installed = JSON.parse(
    await readFile(resolve(baselineRoot, 'node_modules/@purityjs/core/package.json'), 'utf8'),
  );
  assert.equal(installed.version, '0.4.0', 'The installed baseline must be @purityjs/core 0.4.0');
  assert.equal(
    lock.packages['node_modules/@purityjs/core']?.version,
    '0.4.0',
    'The baseline lockfile must identify @purityjs/core 0.4.0',
  );
  const limit = Math.floor(outputs[0].gzipBytes / 2);
  const current = outputs[1].gzipBytes;
  if (current > limit) {
    console.error(
      `50% browser API gzip target not met: ${current} B exceeds ${limit} B by ${current - limit} B`,
    );
    process.exitCode = 1;
  }
}
