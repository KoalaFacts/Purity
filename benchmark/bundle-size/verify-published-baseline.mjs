import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const dist = resolve('benchmark/dist');
const baseline = join(dist, 'release-040');
const installed = join(baseline, 'node_modules/@purityjs/core');
const lock = JSON.parse(readFileSync(join(baseline, 'package-lock.json'), 'utf8'));
const record = lock.packages['node_modules/@purityjs/core'];
assert.equal(record.version, '0.4.0');
const url = new URL(record.resolved);
assert.equal(url.protocol, 'https:');
assert.equal(url.hostname, 'registry.npmjs.org');
assert.equal(url.pathname, '/@purityjs/core/-/core-0.4.0.tgz');

function files(root, dir = root) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...files(root, path));
    else {
      assert(entry.isFile(), `Unexpected non-file entry: ${relative(root, path)}`);
      result.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  return result.sort();
}

const response = await fetch(url);
assert(response.ok, `Published package download failed: ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
assert.equal(integrity, record.integrity, 'Published archive differs from the lockfile');

const temp = mkdtempSync(join(dist, 'published-baseline-check-'));
try {
  const tarball = join(temp, 'core.tgz');
  const extracted = join(temp, 'extracted');
  mkdirSync(extracted);
  writeFileSync(tarball, archive);
  execFileSync('tar', ['-xzf', tarball, '-C', extracted]);
  const published = join(extracted, 'package');
  const publishedFiles = files(published);
  assert.deepEqual(files(installed), publishedFiles, 'Installed baseline file list differs');
  for (const file of publishedFiles) {
    const expected = createHash('sha256')
      .update(readFileSync(join(published, file)))
      .digest('hex');
    const actual = createHash('sha256')
      .update(readFileSync(join(installed, file)))
      .digest('hex');
    assert.equal(actual, expected, `Installed baseline differs: ${file}`);
  }
  console.log(
    JSON.stringify({
      package: '@purityjs/core',
      version: record.version,
      integrity,
      files: publishedFiles.length,
    }),
  );
} finally {
  const target = realpathSync(temp);
  assert(target.startsWith(realpathSync(dist) + sep), 'Temporary path escaped benchmark/dist');
  rmSync(target, { recursive: true, force: true });
}
