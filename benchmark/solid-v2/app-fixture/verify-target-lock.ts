// SV2-001: verify a real isolated npm v3 lock and installed export inputs.
// Identity evidence only; this does not execute a browser or measure performance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const targetFile = join(root, '..', 'target.json');
const manifestFile = join(root, 'package.json');
const lockFile = join(root, 'package-lock.json');
const modulesRoot = join(root, 'node_modules');
const reportFile = join(root, 'validation-report.json');
const readJSON = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
const hashFile = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const target = readJSON(targetFile);
const manifest = readJSON(manifestFile);
const lock = readJSON(lockFile);
assert.equal(target.baseline, 'Solid 2.0.0-rc.18');
assert.equal(lock.lockfileVersion, 3);
assert.equal(lock.packages['']?.name, manifest.name);
assert.deepEqual(lock.packages['']?.dependencies, manifest.dependencies);
assert.equal(manifest.dependencies.vite, '8.3.5');
assert.equal(lock.packages['node_modules/vite']?.version, '8.3.5');
assert.equal(Object.hasOwn(manifest.dependencies, '@solidjs/start'), false);

const pinned = target.packages.filter((entry: any) => entry.includedInSolid2Target === true);
assert.equal(pinned.length, 7);
const verifiedPackages = [];
for (const entry of pinned) {
  assert.equal(manifest.dependencies[entry.name], entry.version);
  const locked = lock.packages[`node_modules/${entry.name}`];
  assert.ok(locked, `Missing full lockfile entry: ${entry.name}`);
  assert.equal(locked.version, entry.version);
  assert.equal(locked.integrity, entry.dist.integrity);
  const installed = readJSON(join(modulesRoot, entry.name, 'package.json'));
  assert.equal(installed.version, entry.version);
  verifiedPackages.push({
    name: entry.name,
    version: locked.version,
    integrity: locked.integrity,
    resolved: locked.resolved,
  });
}

const clientEntries = [
  'solid-js/dist/solid.js',
  '@solidjs/signals/dist/prod/index.js',
  '@solidjs/web/dist/web.js',
];
const verifiedClientEntries = clientEntries.map((entry) => {
  const path = join(modulesRoot, entry);
  assert.ok(existsSync(path), `Missing client entry: ${entry}`);
  return { entry, sha256: hashFile(path) };
});
const clientRequire = createRequire(join(modulesRoot, clientEntries[0]));
const resolvedSignals = relative(modulesRoot, clientRequire.resolve('@solidjs/signals'))
  .split(sep)
  .join('/');
assert.equal(resolvedSignals, '@solidjs/signals/dist/prod/index.js');

const report = {
  schemaVersion: 1,
  scope: 'SV2-001 installed rc.18 lock and client entry identity',
  status: 'input_verified_not_application_or_performance_parity',
  sourceRef: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  nodeOptions: process.env.NODE_OPTIONS ?? '',
  lockSha256: hashFile(lockFile),
  targetSha256: hashFile(targetFile),
  manifestSha256: hashFile(manifestFile),
  packageCountIncludingTransitives: Object.keys(lock.packages).length,
  verifiedPackages,
  verifiedClientEntries,
  resolvedSignals,
  notMeasured: [
    'client/server export execution',
    'DOM/SSR/hydration semantic fixture',
    'every emitted JS chunk',
    'startup/update timing',
    'allocations/retained heap',
    'matched Purity-vs-Solid performance',
  ],
};
writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  `SV2-001: verified ${verifiedPackages.length} targets, ${report.packageCountIncludingTransitives} lock nodes and three client entries`,
);
