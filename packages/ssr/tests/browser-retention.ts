#!/usr/bin/env node
// Exercise the generated SSR production app against tarballs packed from this checkout.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';

const repo = resolve(import.meta.dirname, '../../..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm');

const npmEnv = { ...process.env };
for (const key of Object.keys(npmEnv)) {
  if (key.toLowerCase().startsWith('npm_config_')) delete npmEnv[key];
}

async function run(args: string[], cwd: string): Promise<string> {
  const child = spawn(process.execPath, args, {
    cwd,
    env: npmEnv,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8_000);
  });
  const timeout = new AbortController();
  let code: number;
  try {
    code = await Promise.race([
      new Promise<number>((done, reject) => {
        child.once('close', (result) => done(result ?? 1));
        child.once('error', reject);
      }),
      delay(300_000, undefined, { signal: timeout.signal }).then(async () => {
        await stop(child, true);
        throw new Error(`${args.join(' ')} timed out\n${stdout}\n${stderr}`);
      }),
    ]);
  } finally {
    timeout.abort();
  }
  if (code !== 0) throw new Error(`${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`);
  return stdout;
}

async function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No preview port'));
      server.close(() => done(address.port));
    });
  });
}

async function stop(child: ChildProcess, force = false): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000,
    });
    await new Promise<void>((done) => {
      killer.once('error', () => done());
      killer.once('close', () => done());
    });
  } else {
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      child.kill();
    }
  }
}

async function checkBrowser(browserType: BrowserType, url: string): Promise<void> {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    let releaseScripts!: () => void;
    const scriptsReleased = new Promise<void>((done) => {
      releaseScripts = done;
    });
    await page.route(
      (requestUrl) => requestUrl.pathname.endsWith('.js'),
      async (route) => {
        await scriptsReleased;
        await route.continue();
      },
    );
    let host;
    let button;
    try {
      const response = await page.goto(url, { waitUntil: 'commit' });
      assert.equal(response?.status(), 200);
      host = await page.locator('p-counter').elementHandle();
      button = await page.locator('p-counter button').elementHandle();
      assert.ok(host && button, 'SSR must provide the button before client code loads');
    } finally {
      releaseScripts();
    }
    await page.waitForLoadState('networkidle');
    assert.deepEqual(
      await page.evaluate(
        ({ originalHost, originalButton }) => ({
          host: originalHost === document.querySelector('p-counter'),
          button:
            originalButton ===
            document.querySelector('p-counter')?.shadowRoot?.querySelector('button'),
          hostConnected: originalHost.isConnected,
          buttonConnected: originalButton.isConnected,
        }),
        { originalHost: host, originalButton: button },
      ),
      { host: true, button: true, hostConnected: true, buttonConnected: true },
      'hydration must retain the server-rendered host and button',
    );
    await page.locator('p-counter button').click();
    await page.waitForFunction(() =>
      document.querySelector('p-counter')?.shadowRoot?.textContent?.includes('Count: 1'),
    );
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: SSR button retained and first click passed`);
  } finally {
    await browser.close();
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'purity-ssr-retention-'));
const tempRoot = await realpath(tmpdir());
const target = await realpath(scratch);
assert.ok(
  dirname(target) === tempRoot && basename(target).startsWith('purity-ssr-retention-'),
  'Unexpected temporary project location',
);
try {
  const { version: releaseVersion } = JSON.parse(
    await readFile(join(repo, 'package.json'), 'utf8'),
  ) as {
    version: string;
  };
  const tarballs = new Map<string, string>();
  for (const pkg of ['@purityjs/core', '@purityjs/ssr', '@purityjs/vite-plugin', '@purityjs/cli']) {
    const output = await run(
      [npmCli, 'pack', '--json', '--pack-destination', target, '-w', pkg],
      repo,
    );
    const packed = JSON.parse(output) as
      | Record<string, { filename: string; version: string }>
      | Array<{ filename: string; version: string }>;
    const entry = Array.isArray(packed) ? packed[0] : packed[pkg];
    assert.ok(entry?.filename, `Could not pack ${pkg}`);
    assert.equal(entry.version, releaseVersion, `${pkg} tarball has the wrong version`);
    tarballs.set(pkg, entry.filename);
  }
  await run(
    [
      npmCli,
      'exec',
      '--yes',
      `--package=./${tarballs.get('@purityjs/cli')}`,
      '--',
      'purity',
      'app',
      '--ssr',
    ],
    target,
  );
  const project = join(target, 'app');
  const manifestPath = join(project, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  for (const pkg of ['@purityjs/core', '@purityjs/ssr', '@purityjs/vite-plugin']) {
    const deps = pkg === '@purityjs/vite-plugin' ? manifest.devDependencies : manifest.dependencies;
    assert.equal(deps[pkg], `^${releaseVersion}`, `${pkg} scaffold spec is outdated`);
    deps[pkg] = `file:${join(target, tarballs.get(pkg)!)}`;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(project, 'vite.config.ts'),
    "import { purity } from '@purityjs/vite-plugin';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [purity()] });\n",
  );
  await run([npmCli, 'install', '--no-audit', '--no-fund'], project);
  for (const pkg of ['@purityjs/core', '@purityjs/ssr', '@purityjs/vite-plugin']) {
    const { version } = JSON.parse(
      await readFile(join(project, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8'),
    ) as { version: string };
    assert.equal(version, releaseVersion, `${pkg} installed at the wrong version`);
  }
  await run([npmCli, 'run', 'build'], project);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const preview = spawn(process.execPath, [npmCli, 'run', 'preview'], {
    cwd: project,
    env: { ...npmEnv, PORT: String(port) },
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {
        // Preview may still be starting.
      }
      await delay(250);
    }
    assert.ok(ready, 'Production preview did not become ready');
    for (const browserType of [chromium, firefox, webkit]) {
      await checkBrowser(browserType, url);
    }
  } finally {
    if (preview.exitCode === null) await stop(preview);
  }
} finally {
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
