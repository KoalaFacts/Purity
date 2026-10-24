import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const position = process.argv.indexOf('--dest');
const destination = position === -1 ? undefined : process.argv[position + 1];
if (!destination || destination.startsWith('--')) {
  throw new Error('Usage: node fetch-packages.ts --dest <empty-directory>');
}
const inputs = JSON.parse(await readFile(resolve(directory, 'inputs.json'), 'utf8'));
if (process.version !== inputs.runtime.node) throw new Error(`Use Node ${inputs.runtime.node}`);
const target = resolve(destination);
await mkdir(target, { recursive: true });
if ((await readdir(target)).length !== 0) throw new Error('--dest must be an empty directory');
const staging = await mkdtemp(resolve(target, '.extract-'));
const records = [];

async function get(url: string) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://registry.npmjs.org')
    throw new Error('Expected official npm registry URL');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Registry GET failed: ${response.status} ${url}`);
  return response;
}

try {
  for (const expected of inputs.solid.packages) {
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(expected.name)}/${encodeURIComponent(expected.version)}`;
    const metadata = await (await get(registryUrl)).json();
    if (
      metadata.name !== expected.name ||
      metadata.version !== expected.version ||
      metadata.gitHead !== inputs.solid.git_commit ||
      metadata.dist.integrity !== expected.integrity
    ) {
      throw new Error(`Pinned registry metadata mismatch: ${expected.name}`);
    }
    const payload = Buffer.from(await (await get(metadata.dist.tarball)).arrayBuffer());
    const integrity = `sha512-${createHash('sha512').update(payload).digest('base64')}`;
    if (integrity !== expected.integrity)
      throw new Error(`Pinned SHA512 mismatch: ${expected.name}`);
    const archive = resolve(staging, 'package.tgz');
    await writeFile(archive, payload);
    // Only verified bytes reach tar; arguments are passed directly, never to a shell.
    const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    if (members.some((name) => !name.startsWith('package/') || name.split('/').includes('..'))) {
      throw new Error(`Unexpected archive path: ${expected.name}`);
    }
    const packageDirectory = resolve(target, 'node_modules', expected.name);
    await mkdir(packageDirectory, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      archive,
      '-C',
      packageDirectory,
      '--strip-components=1',
      '--no-same-owner',
      '--no-same-permissions',
    ]);
    records.push({
      name: expected.name,
      version: expected.version,
      registry_url: registryUrl,
      tarball: metadata.dist.tarball,
      integrity,
      shasum: createHash('sha1').update(payload).digest('hex'),
      gitHead: metadata.gitHead,
      tar_sha256: createHash('sha256').update(payload).digest('hex'),
    });
  }
  for (const [relativePath, expected] of Object.entries(inputs.solid.entry_sha256)) {
    const bytes = await readFile(resolve(target, 'node_modules', relativePath));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw new Error(`Extracted entry SHA256 mismatch: ${relativePath}`);
    }
  }
  await writeFile(
    resolve(target, 'package-provenance.json'),
    JSON.stringify(records, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ verified_packages: records }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
