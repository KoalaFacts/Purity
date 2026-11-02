import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
const budget = load(resolve('benchmark/bundle-size/core-install-budget.json'));
const manifest = load(process.argv[2]);
const packed = Array.isArray(manifest)
  ? Object.fromEntries(manifest.map((item) => [item.name, item]))
  : manifest;
assert.equal(budget.baseline.package, '@purityjs/core');
assert.equal(budget.baseline.version, '0.4.0');
assert.equal(budget.maxCombinedCompressedBytes, Math.floor(budget.baseline.compressedBytes / 2));
assert.deepEqual([...budget.packages].sort(), [
  '@purityjs/compiler',
  '@purityjs/core',
  '@purityjs/signals',
]);

const manifests = Object.fromEntries(
  budget.packages.map((name) => {
    const packageName = name.slice('@purityjs/'.length);
    const local = load(resolve('packages', packageName, 'package.json'));
    assert.equal(local.name, name);
    assert.equal(packed[name]?.version, local.version, `Missing or stale packed ${name}`);
    assert(Number.isSafeInteger(packed[name].size) && packed[name].size > 0);
    assert.equal(
      Object.keys(local.optionalDependencies ?? {}).length,
      0,
      `${name} has uncounted optional dependencies`,
    );
    assert.equal(
      Object.keys(local.peerDependencies ?? {}).length,
      0,
      `${name} has uncounted peer dependencies`,
    );
    return [name, local];
  }),
);
const coreDeps = manifests['@purityjs/core'].dependencies ?? {};
assert.deepEqual(Object.keys(coreDeps).sort(), ['@purityjs/compiler', '@purityjs/signals']);
for (const name of Object.keys(coreDeps)) assert.equal(coreDeps[name], manifests[name].version);
for (const name of ['@purityjs/signals', '@purityjs/compiler'])
  assert.equal(
    Object.keys(manifests[name].dependencies ?? {}).length,
    0,
    `${name} has uncounted runtime dependencies`,
  );

const sizes = Object.fromEntries(budget.packages.map((name) => [name, packed[name].size]));
const total = Object.values(sizes).reduce((sum, value) => sum + value, 0);
console.log(
  JSON.stringify({
    sizes,
    total,
    maxBytes: budget.maxCombinedCompressedBytes,
    headroomBytes: budget.maxCombinedCompressedBytes - total,
    reductionPercent:
      ((budget.baseline.compressedBytes - total) * 100) / budget.baseline.compressedBytes,
  }),
);
assert(total <= budget.maxCombinedCompressedBytes, 'Core installation archive budget exceeded');
