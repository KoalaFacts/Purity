import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';

const path = new URL('./finalize-release.mjs', import.meta.url);
const sha = 'a'.repeat(40);
async function runCase(options = {}) {
  assert.ok(existsSync(path), 'publish completion must create a verified GitHub Release');
  const { finalizeRelease } = await import(path.href);
  const calls = [];
  const version = options.version ?? '0.4.0';
  let packages = 0;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === options.failCommand || args[0] === options.failCommand)
      throw new Error('transport failure');
    if (command === 'npm') {
      packages++;
      return JSON.stringify({
        version,
        gitHead:
          packages === (options.badPackage ?? 1)
            ? options.missingHead
              ? undefined
              : (options.packageSha ?? sha)
            : sha,
      });
    }
    if (command === 'gh' && args[0] === 'api')
      return (options.releases ?? []).map((release) => JSON.stringify(release)).join('\n');
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'ls-remote')
      return (
        options.tagRefs ?? (options.tagSha ? `${options.tagSha}\trefs/tags/v${version}\n` : '')
      );
    return '';
  };
  let error;
  try {
    finalizeRelease(version, run);
  } catch (caught) {
    error = caught;
  }
  return { calls, error };
}

test('publishes release only after four package origins and remote tag are verified', async () => {
  const { calls, error } = await runCase();
  assert.equal(error, undefined);
  assert.equal(calls.filter(([cmd]) => cmd === 'npm').length, 4);
  assert.deepEqual(calls.at(-1), [
    'gh',
    'release',
    'create',
    'v0.4.0',
    '--verify-tag',
    '--target',
    sha,
    '--generate-notes',
  ]);
  assert.ok(calls.findIndex((call) => call[1] === 'push') < calls.length - 1);
});

test('refuses mixed package source commits before any tag or release mutation', async () => {
  const { calls, error } = await runCase({ packageSha: 'b'.repeat(40) });
  assert.match(error.message, /source/);
  assert.ok(!calls.some((call) => ['tag', 'push', 'release'].includes(call[1])));
});

test('refuses an existing tag on another commit without moving it', async () => {
  const { calls, error } = await runCase({ tagSha: 'b'.repeat(40) });
  assert.match(error.message, /tag/);
  assert.ok(!calls.some((call) => ['tag', 'push', 'release'].includes(call[1])));
});

test('reuses an existing exact tag to recover the missing release', async () => {
  const { calls, error } = await runCase({ tagSha: sha });
  assert.equal(error, undefined);
  assert.ok(!calls.some((call) => ['tag', 'push'].includes(call[1])));
  assert.equal(calls.at(-1)[1], 'release');
});

test('preserves prerelease versions and marks their GitHub release as prerelease', async () => {
  const { calls, error } = await runCase({ version: '0.4.0-rc.1' });
  assert.equal(error, undefined);
  assert.ok(calls.at(-1).includes('--prerelease'));
});
test('checks the fourth package and refuses missing gitHead', async () => {
  const { calls, error } = await runCase({ badPackage: 4, missingHead: true });
  assert.match(error.message, /source/);
  assert.equal(calls.filter(([cmd]) => cmd === 'npm').length, 4);
  assert.ok(!calls.some((call) => ['tag', 'push', 'release'].includes(call[1])));
});
test('resolves annotated tags to their peeled commit', async () => {
  const { calls, error } = await runCase({
    tagRefs: `${'b'.repeat(40)}\trefs/tags/v0.4.0\n${sha}\trefs/tags/v0.4.0^{}\n`,
  });
  assert.equal(error, undefined);
  assert.ok(!calls.some((call) => ['tag', 'push'].includes(call[1])));
});
for (const failCommand of ['npm', 'ls-remote', 'push'])
  test(`${failCommand} failure prevents Release creation`, async () => {
    const { calls, error } = await runCase({ failCommand });
    assert.match(error.message, /transport/);
    assert.ok(!calls.some(([cmd, operation]) => cmd === 'gh' && operation === 'release'));
  });

test('recovers a previously published Release without creating it again', async () => {
  const { calls, error } = await runCase({
    tagSha: sha,
    releases: [{ tag_name: 'v0.4.0', draft: false, prerelease: false }],
  });
  assert.equal(error, undefined);
  assert.ok(!calls.some((call) => call[1] === 'release' && call[2] === 'create'));
});
test('does not silently accept an existing draft or wrong prerelease status', async () => {
  for (const release of [
    { draft: true, prerelease: false },
    { draft: false, prerelease: true },
  ]) {
    const { calls, error } = await runCase({
      tagSha: sha,
      releases: [{ tag_name: 'v0.4.0', ...release }],
    });
    assert.match(error.message, /existing Release/);
    assert.ok(!calls.some((call) => call[1] === 'release'));
  }
});
test('Release lookup failure does not trigger creation', async () => {
  const { calls, error } = await runCase({ failCommand: 'api' });
  assert.match(error.message, /transport/);
  assert.ok(!calls.some((call) => call[1] === 'release'));
});
