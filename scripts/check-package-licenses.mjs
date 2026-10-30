import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run through npm run check:licenses');
const read = (path) => readFileSync(join(root, path), 'utf8');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const { version } = JSON.parse(read('package.json'));
const [major, minor] = version.split('.').map(Number);
const apache = major > 0 || minor >= 5;
const license = apache ? 'Apache-2.0' : 'MIT';
const primary = read('LICENSE');
// Immutable official Apache text and original Purity MIT notice, respectively.
const apacheHash = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
const mitHash = '5c2882c562272c67cd917f6c4aa0a6bf26bd600a781bb218d164e60a1509e2d9';
assert.equal(hash(primary), apache ? apacheHash : mitHash, 'Root license policy changed');
if (apache) {
  assert.equal(hash(read('LICENSES/Purity-MIT.txt')), mitHash, 'Preserve the original MIT notice');
  assert.match(read('NOTICE'), /Copyright \(c\) 2026 KoalaFacts/);
  assert.equal(
    read('LICENSES/oxc-parser-MIT.txt'),
    read('node_modules/oxc-parser/LICENSE'),
    'Keep the external parser notice consistent with the installed dependency',
  );
}

const output = mkdtempSync(join(tmpdir(), 'purity-package-licenses-'));
const failures = [];
try {
  for (const short of [
    'signals',
    'compiler',
    'core',
    'router',
    'platform',
    'ssr',
    'vite-plugin',
    'cli',
  ]) {
    const name = `@purityjs/${short}`;
    try {
      const packedResult = JSON.parse(
        execFileSync(
          process.execPath,
          [npmCli, 'pack', '--json', '--workspace', name, '--pack-destination', output],
          { cwd: root, encoding: 'utf8', timeout: 60_000 },
        ),
      );
      const packed = Array.isArray(packedResult) ? packedResult[0] : packedResult[name];
      assert.ok(packed?.filename, `${name}: npm pack did not report an archive`);
      const archive = join(output, packed.filename);
      const files = new Set(packed.files.map((file) => file.path));
      const content = (path) => {
        assert.ok(files.has(path), `${name}: packed ${path} is missing`);
        return execFileSync('tar', ['-xOf', archive, `package/${path}`], { encoding: 'utf8' });
      };
      const manifest = JSON.parse(content('package.json'));
      assert.equal(manifest.version, version, `${name}: version mismatch`);
      assert.equal(manifest.license, license, `${name}: SPDX mismatch`);
      assert.equal(content('LICENSE'), primary, `${name}: full license text mismatch`);
      if (apache) {
        assert.equal(content('LICENSES/Purity-MIT.txt'), read('LICENSES/Purity-MIT.txt'));
        const notice = content('NOTICE');
        assert.equal(notice, read(`packages/${short}/NOTICE`));
        assert.ok(notice.startsWith(read('NOTICE')), `${name}: project attribution missing`);
        if (short === 'vite-plugin') {
          assert.equal(content('LICENSES/oxc-parser-MIT.txt'), read('LICENSES/oxc-parser-MIT.txt'));
          assert.match(notice, /oxc-parser/);
          assert.match(notice, /VoidZero Inc\. & Contributors/);
          assert.match(notice, /Boshen/);
        }
      }
      console.log(`${name}@${version}: packed ${license} license and retained notices verified`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
assert.deepEqual(failures, [], 'Published packages must contain their applicable license texts');
