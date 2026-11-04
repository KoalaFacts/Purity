import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const audit = resolve(root, 'benchmark/dist/core-pack-audit');
const consumer = resolve(root, 'benchmark/dist/core-pack-consumer');
const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
const baseline = load(resolve(audit, 'baseline.json'));
const current = load(resolve(audit, 'current.json'));
const browser = load(resolve(audit, 'browser-comparison.json'));
const installedLock = load(resolve(consumer, 'node_modules/.package-lock.json'));
const packages = ['@purityjs/core', '@purityjs/signals', '@purityjs/compiler'];
assert.deepEqual(
  Object.keys(installedLock.packages).sort(),
  packages.map((name) => `node_modules/${name}`).sort(),
  'The installed dependency closure contains unexpected packages',
);

function checkArchive(record, version) {
  assert(record && record.version === version);
  const bytes = readFileSync(resolve(audit, record.filename));
  assert.equal(bytes.length, record.size);
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, record.integrity);
  return bytes.length;
}

const old = baseline['@purityjs/core'];
assert.equal(
  old.integrity,
  'sha512-HO1gK1r3eDkskXLIZfUWxSYvt4NHON2GPTkIXpfBFjzAux2ENdZTFgI+/kxPwoX40Ufv8svSvoXKKei0Q5M64Q==',
);
const oldBytes = checkArchive(old, '0.4.0');
assert.deepEqual(Object.keys(current).sort(), [...packages].sort());
const archives = Object.fromEntries(
  packages.map((name) => [name, checkArchive(current[name], '0.5.0')]),
);
const total = Object.values(archives).reduce((sum, size) => sum + size, 0);
for (const name of packages) {
  const installed = load(resolve(consumer, 'node_modules', name, 'package.json'));
  const lockEntry = installedLock.packages[`node_modules/${name}`];
  assert.equal(lockEntry?.integrity, current[name].integrity);
  assert(lockEntry.resolved?.startsWith('file:'), `${name} is not installed from a local archive`);
  assert.equal(browser.currentInstalledIntegrities?.[name], current[name].integrity);
  assert.equal(installed.name, name);
  assert.equal(installed.version, '0.5.0');
  assert.equal(Object.keys(installed.optionalDependencies ?? {}).length, 0);
  assert.equal(Object.keys(installed.peerDependencies ?? {}).length, 0);
  if (name === '@purityjs/core') {
    assert.deepEqual(installed.dependencies, {
      '@purityjs/compiler': '0.5.0',
      '@purityjs/signals': '0.5.0',
    });
  } else {
    assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
  }
}
const oldPackage = load(
  resolve(root, 'benchmark/dist/release-040/node_modules/@purityjs/core/package.json'),
);
assert.equal(oldPackage.version, '0.4.0');
assert.equal(Object.keys(oldPackage.dependencies ?? {}).length, 0);
assert.equal(Object.keys(oldPackage.peerDependencies ?? {}).length, 0);
assert.equal(Object.keys(oldPackage.optionalDependencies ?? {}).length, 0);
assert.equal(browser.verification.status, 'passed');
assert.equal(browser.baselinePackage.integrity, old.integrity);
assert.deepEqual(Object.keys(browser.verification.engines).sort(), [
  'chromium',
  'firefox',
  'webkit',
]);
assert.equal(browser.results.length, 2);
assert.deepEqual(browser.results[0].exports, browser.results[1].exports);
assert.equal(browser.results[0].exports.length, 28);
const installedCheck = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ['@purityjs/core', '@purityjs/signals', '@purityjs/compiler']) {
  const esm = await import(name), cjs = require(name);
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  for (const api of [esm, cjs]) {
    if (name === '@purityjs/signals') {
      const state = api.state(0), values = [];
      const stop = api.watch(() => values.push(state()));
      state(1); await Promise.resolve(); stop();
      assert.deepEqual(values, [0, 1]);
    }
    if (name === '@purityjs/compiler') {
      assert.equal(typeof api.generate(api.parse(['<div>ok</div>'])), 'string');
    }
  }
  console.log(name, Object.keys(esm).length, 'ESM/CJS exports and smoke passed');
}`;
execFileSync(process.execPath, ['--input-type=module', '-e', installedCheck], {
  cwd: consumer,
  stdio: 'inherit',
});
execFileSync(
  process.execPath,
  [
    resolve(root, 'benchmark/bundle-size/verify-published-source-maps.mjs'),
    resolve(audit, 'current.json'),
    '--core-only',
    '--installed-root',
    consumer,
  ],
  { stdio: 'inherit' },
);
assert(
  total <= Math.floor(oldBytes / 2),
  `Core archive total ${total} exceeds half of ${oldBytes}`,
);
console.log(
  JSON.stringify({
    baseline: oldBytes,
    archives,
    total,
    reductionPercent: ((oldBytes - total) * 100) / oldBytes,
    browserGzip: browser.results.map(({ version, gzipBytes }) => ({ version, gzipBytes })),
    browserSmoke: browser.verification,
  }),
);
