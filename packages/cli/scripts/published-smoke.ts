#!/usr/bin/env node
// Exercise the published CLI and packages from outside the monorepo.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check through npm run test:published-cli');

type Mode = 'client' | 'ssr';
const packages = ['@purityjs/cli', '@purityjs/core', '@purityjs/ssr', '@purityjs/vite-plugin'];
const maxOutput = 16_000;

function collect(child: ChildProcess): { output: () => string; stdout: () => string } {
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-maxOutput);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-maxOutput);
  });
  return { output: () => `${stdout}\n${stderr}`, stdout: () => stdout };
}

async function runNpm(args: string[], cwd: string, timeoutMs = 300_000): Promise<string> {
  const child = spawn(process.execPath, [npmCli!, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const log = collect(child);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (result) => resolve(result ?? 1));
    });
    if (timedOut || code !== 0) {
      throw new Error(
        `npm ${args.join(' ')} ${timedOut ? 'timed out' : `exited ${code}`}\n${log.output()}`,
      );
    }
    return log.stdout();
  } finally {
    clearTimeout(timer);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a preview port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForPreview(url: string, child: ChildProcess, log: () => string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Preview exited early\n${log()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Preview did not become ready: ${url}\n${log()}`);
}

async function stopPreview(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await new Promise<void>((resolve) => killer.once('close', () => resolve()));
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  }
}

async function checkBrowser(browserType: BrowserType, mode: Mode, url: string): Promise<void> {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200);
    const counter = page.locator('p-counter p');
    await counter.waitFor();
    assert.match((await counter.textContent()) ?? '', /Count:\s*0/);
    const button = page.locator('p-counter button').first();
    const originalButton = await button.elementHandle();
    assert.ok(originalButton);
    await button.click();
    await page.waitForFunction(() =>
      document
        .querySelector('p-counter')
        ?.shadowRoot?.querySelector('p')
        ?.textContent?.includes('Count: 1'),
    );
    assert.match((await counter.textContent()) ?? '', /Count:\s*1/);
    if (mode === 'ssr') {
      assert.equal(
        await page.evaluate(
          (original) =>
            document.querySelector('p-counter')?.shadowRoot?.querySelector('button') === original,
          originalButton,
        ),
        true,
        'hydration must retain the server-rendered button',
      );
    }
    assert.deepEqual(errors, []);
    console.log(`${mode} ${browserType.name()}: production preview and first click passed`);
  } finally {
    await browser.close();
  }
}

async function checkProject(
  root: string,
  mode: Mode,
  versions: Map<string, string>,
): Promise<void> {
  const name = `purity-smoke-${mode}`;
  await runNpm(
    [
      'exec',
      '--yes',
      `--package=@purityjs/cli@${versions.get('@purityjs/cli')}`,
      '--',
      'purity',
      name,
      ...(mode === 'ssr' ? ['--ssr'] : []),
    ],
    root,
  );
  const project = join(root, name);
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  for (const pkg of mode === 'ssr' ? packages.slice(1) : [packages[1], packages[3]]) {
    const spec = manifest.dependencies[pkg] ?? manifest.devDependencies[pkg];
    assert.ok(spec && !spec.startsWith('file:'), `${pkg} must come from npm`);
  }
  await runNpm(['install', '--no-audit', '--no-fund'], project);
  for (const pkg of mode === 'ssr' ? packages.slice(1) : [packages[1], packages[3]]) {
    const installed = JSON.parse(
      await readFile(join(project, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8'),
    ) as { version: string };
    assert.equal(
      installed.version,
      versions.get(pkg),
      `${pkg} is not the latest published version`,
    );
  }
  await runNpm(['run', 'build'], project);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const args = [
    'run',
    'preview',
    ...(mode === 'client'
      ? ['--', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
      : []),
  ];
  const preview = spawn(process.execPath, [npmCli!, ...args], {
    cwd: project,
    env: { ...process.env, ...(mode === 'ssr' ? { PORT: String(port) } : {}) },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const log = collect(preview);
  try {
    await waitForPreview(url, preview, log.output);
    if (mode === 'ssr') {
      const html = await (await fetch(url)).text();
      assert.match(html, /shadowrootmode="open"/);
      assert.match(html, /Count:\s*<!--\[-->0<!--\]-->/);
    }
    for (const browserType of [chromium, firefox, webkit]) {
      await checkBrowser(browserType, mode, url);
    }
  } finally {
    await stopPreview(preview);
  }
}

const root = await mkdtemp(join(tmpdir(), 'purity-published-smoke-'));
const target = await realpath(root);
const tempRoot = await realpath(tmpdir());
assert.ok(
  dirname(target) === tempRoot && basename(target).startsWith('purity-published-smoke-'),
  `Unexpected smoke directory: ${target}`,
);
try {
  const versions = new Map<string, string>();
  for (const pkg of packages) {
    const version = (await runNpm(['view', pkg, 'version', '--prefer-online'], root)).trim();
    assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `Invalid npm version for ${pkg}`);
    versions.set(pkg, version);
  }
  console.log(
    `Published packages: ${[...versions].map(([pkg, version]) => `${pkg}@${version}`).join(', ')}`,
  );
  await checkProject(root, 'client', versions);
  await checkProject(root, 'ssr', versions);
} finally {
  // Only remove the specific directory created by mkdtemp under the OS temp root.
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
