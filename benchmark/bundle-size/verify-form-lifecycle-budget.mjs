import assert from 'node:assert/strict';
import { build } from 'vite';
import { resolve } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
const entry = resolve('benchmark/dist/form-lifecycle-all.js').replaceAll('\\', '/');
const source = "export * from '@purityjs/core/forms/lifecycle';";
const out = await build({
  configFile: false,
  mode: 'production',
  logLevel: 'silent',
  resolve: { conditions: ['module', 'browser', 'production'] },
  plugins: [
    {
      name: 'fixture',
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
const chunks = out.output.filter((item) => item.type === 'chunk');
assert.equal(chunks.length, 1);
assert.equal(chunks[0].imports.length, 0);
assert.equal(chunks[0].dynamicImports.length, 0);
assert.deepEqual(
  chunks[0].exports.sort(),
  [
    'enableFormLifecycle',
    'formComponent',
    'onFormAssociated',
    'onFormDisabled',
    'onFormReset',
    'onFormStateRestore',
  ].sort(),
);
const bytes = Buffer.from(chunks[0].code);
const gzip = gzipSync(bytes, { level: 9 }).length;
const brotli = brotliCompressSync(bytes, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;
assert(gzip <= 3072, `Form lifecycle gzip budget exceeded: ${gzip}`);
assert(brotli <= 2688, `Form lifecycle Brotli budget exceeded: ${brotli}`);
console.log(
  JSON.stringify({ raw: bytes.length, gzip, brotli, budgets: { gzip: 3072, brotli: 2688 } }),
);
