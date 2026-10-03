import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const cli = resolve(import.meta.dirname, '../dist/index.js');
const target = await mkdtemp(join(tmpdir(), 'purity-request-security-'));
const failures: string[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

async function request(port: number, path: string, method = 'GET', origin?: string) {
  return new Promise<{ status: number; body: string }>((done, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: origin ? { Origin: origin } : {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => done({ status: res.statusCode!, body }));
        res.on('error', reject);
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function check(condition: boolean, label: string): void {
  if (!condition) failures.push(label);
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`);
}

try {
  // Directory junctions exercise the same escape on Windows without symlink privileges.
  const privateDir = join(target, 'private');
  await mkdir(privateDir);
  await writeFile(join(privateDir, 'secret.txt'), 'PURITY_PRIVATE_FILE_MARKER');
  for (const mode of ['app', 'ssr']) {
    const generated = spawnSync(process.execPath, [cli, mode, `--${mode}`], {
      cwd: target,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const project = join(target, mode);
    const client = join(project, 'client');
    await mkdir(client);
    await mkdir(join(project, 'server'));
    await writeFile(join(client, 'index.html'), '<!--head-outlet--><!--ssr-outlet-->');
    await writeFile(join(project, 'template.html'), '<!--head-outlet--><!--ssr-outlet-->');
    await writeFile(join(project, 'static-routes.json'), '[]');
    await writeFile(join(client, 'public.txt'), 'public asset');
    await mkdir(join(client, 'allowed'));
    await writeFile(join(client, 'allowed/asset.txt'), 'allowed linked asset');
    await symlink(
      join(client, 'allowed'),
      join(client, 'safe-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await symlink(
      privateDir,
      join(client, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    // Also exercise a static page reached through a directory link.
    await writeFile(join(privateDir, 'index.html'), 'PURITY_PRIVATE_FILE_MARKER');
    await writeFile(
      join(project, 'server/entry.server.js'),
      `
export const routeFor = async () => ({ pattern: '/', mode: 'server' });
export const render = async () => 'safe SSR';
export const renderStream = async () => ({ head: '', body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('safe SSR')); c.close(); } }) });
export const dispatchAction = async (req) => new Response(req.url, { headers: { 'x-mutation-executed': 'yes' } });
`,
    );
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', 'server.ts', '--production'],
      {
        cwd: project,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(port), PUBLIC_ORIGIN: origin, TRUST_PROXY: '0' },
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk).slice(-8_000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output = (output + chunk).slice(-8_000);
    });
    const closed = new Promise<void>((done) => child.once('close', () => done()));
    try {
      for (let attempt = 0; !output.includes('http://localhost:'); attempt++) {
        assert.ok(attempt < 200 && child.exitCode === null, output);
        await delay(50);
      }
      const publicAsset = await request(port, '/public.txt');
      assert.equal(publicAsset.status, 200);
      assert.equal(publicAsset.body, 'public asset');
      const linkedAsset = await request(port, '/safe-link/asset.txt');
      assert.equal(linkedAsset.status, 200);
      assert.equal(linkedAsset.body, 'allowed linked asset');
      for (const path of [
        '/linked/secret.txt',
        '/linked/index.html',
        '/%2e%2e%2fprivate/secret.txt',
      ]) {
        for (const method of ['GET', 'HEAD']) {
          const result = await request(port, path, method);
          check(
            result.status >= 400 && !result.body.includes('PURITY_PRIVATE_FILE_MARKER'),
            `${mode}: ${method} rejects ${path}`,
          );
        }
      }
      for (const path of [
        '/\\attacker.example/actions/write',
        '//attacker.example/actions/write',
        'http://attacker.example/actions/write',
      ]) {
        const result = await request(
          port,
          path,
          mode === 'app' ? 'POST' : 'GET',
          'http://attacker.example',
        );
        check(
          result.status === 400,
          `${mode}: rejects an authority-changing request target ${path}`,
        );
      }
      if (mode === 'app') {
        const result = await request(port, '/actions/write', 'POST', origin);
        assert.equal(result.status, 200);
        assert.equal(result.body, `${origin}/actions/write`);
      }
      console.log(`${mode}: public assets and normal requests retained`);
    } finally {
      child.kill();
      await closed;
    }
    if (mode === 'ssr') {
      // The startup shell must obey the same boundary as request-time assets.
      await rm(join(client, 'index.html'));
      let linkKind = 'file symlink';
      try {
        await symlink(join(privateDir, 'index.html'), join(client, 'index.html'), 'file');
      } catch (error) {
        if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') {
          throw error;
        }
        // Windows without file-symlink privileges can still exercise the
        // startup realpath boundary. Linux CI requires the actual file link.
        await symlink(privateDir, join(client, 'index.html'), 'junction');
        linkKind = 'directory junction (file-symlink privileges unavailable)';
      }
      const startup = spawnSync(
        process.execPath,
        ['--experimental-strip-types', 'server.ts', '--production'],
        {
          cwd: project,
          windowsHide: true,
          encoding: 'utf8',
          timeout: 5_000,
          env: { ...process.env, PORT: String(port) },
        },
      );
      check(
        startup.status !== null &&
          startup.status !== 0 &&
          startup.stderr.includes('SSR template must be inside the public root') &&
          !startup.stdout.includes('http://localhost:'),
        `ssr: rejects an external index.html ${linkKind} before listening`,
      );
    }
  }
  assert.deepEqual(failures, [], 'Node request/file security boundary failures');
} finally {
  // target is owned exclusively by this run and was created directly under tmpdir().
  assert.ok(resolve(target).startsWith(resolve(tmpdir()) + sep));
  await rm(target, { recursive: true, force: true });
}
