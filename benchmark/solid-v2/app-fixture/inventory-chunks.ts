// SV2-001/015: enumerate every JavaScript output of the pinned Solid rc.18 app.
// This inventory alone is not matched benchmark or browser behavior evidence.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === '--workloads'),
  'Expected --workloads or no arguments',
);
const workloads = args[0] === '--workloads';
const dist = join(root, workloads ? 'dist-workloads' : 'dist');
const manifest = join(dist, '.vite', 'manifest.json');
assert.ok(existsSync(manifest), 'Missing Vite emitted application manifest');

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });

const chunks = files(dist)
  .filter((path) => path.endsWith('.js'))
  .sort()
  .map((path) => {
    const bytes = readFileSync(path);
    return {
      file: relative(dist, path).split(sep).join('/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      brotliBytes: brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).length,
    };
  });
assert.ok(chunks.length > 0, 'Missing built JavaScript entry');
const mapping = JSON.parse(readFileSync(manifest, 'utf8'));
const entries = workloads ? ['rows.html', 'binding.html'] : ['index.html'];
for (const name of entries) {
  const entry = mapping[name]?.file;
  assert.ok(entry && chunks.some((chunk) => chunk.file === entry), `Unaccounted entry: ${name}`);
}

const report = {
  schemaVersion: 1,
  scope: workloads
    ? 'Solid rc.18 row/binding built JS payload, all emitted chunks'
    : 'Solid rc.18 single-counter built JS payload, all emitted chunks',
  ...(workloads
    ? {
        entries,
        lockSHA256: createHash('sha256')
          .update(readFileSync(join(root, 'package-lock.json')))
          .digest('hex'),
        workloadSourceHashes: Object.fromEntries(
          [
            'src/rows.tsx',
            'src/binding.tsx',
            'rows.html',
            'binding.html',
            'vite.workloads.config.ts',
          ].map((file) => [
            file,
            createHash('sha256')
              .update(readFileSync(join(root, file)))
              .digest('hex'),
          ]),
        ),
      }
    : {}),
  fullApplicationLock: '../package-lock.json',
  execution: 'Vite 8 production app build; no browser/DOM execution',
  sourceRef: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  node: process.version,
  manifestSha256: createHash('sha256').update(readFileSync(manifest)).digest('hex'),
  chunks,
  summedChunkBrotliBytes: chunks.reduce((sum, chunk) => sum + chunk.brotliBytes, 0),
  notMeasured: [
    'same-function DOM and event parity versus Purity',
    'startup/update timings',
    'allocations/retained heap',
    'multi-route lazy application',
  ],
};
writeFileSync(join(dist, 'payload-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`SV2-015: inventoried ${chunks.length} built JS chunks`);
