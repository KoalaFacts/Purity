#!/usr/bin/env node
// Exercise a packaged --app project in development and production.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';

const repo = resolve(import.meta.dirname, '../../..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run through npm run test:browser:app-actions');
const npmEnv = { ...process.env };
for (const key of Object.keys(npmEnv)) {
  if (key.toLowerCase().startsWith('npm_config_')) delete npmEnv[key];
}

function launch(args: string[], cwd: string, env = npmEnv) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout = (stdout + chunk).slice(-16_000)));
  child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk).slice(-16_000)));
  return { child, stdout: () => stdout, output: () => stdout + stderr };
}

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000,
    });
    await new Promise<void>((done) => {
      killer.once('close', () => done());
      killer.once('error', () => done());
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  }
  await closed;
}

async function run(args: string[], cwd: string): Promise<string> {
  const command = launch(args, cwd);
  const timeout = new AbortController();
  try {
    const code = await Promise.race([
      new Promise<number>((done, reject) => {
        command.child.once('close', (value) => done(value ?? 1));
        command.child.once('error', reject);
      }),
      delay(300_000, undefined, { signal: timeout.signal }).then(async () => {
        await stop(command.child);
        throw new Error(`Command timed out\n${command.output()}`);
      }),
    ]);
    assert.equal(code, 0, command.output());
    return command.stdout();
  } finally {
    timeout.abort();
  }
}

async function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      server.close(() => done(address.port));
    });
  });
}

async function chunkedSubmission(origin: string): Promise<number> {
  return new Promise((done, reject) => {
    const request = httpRequest(`${origin}/actions/probe`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'text/plain' },
    });
    request.on('error', reject);
    request.on('response', (response) => {
      response.resume();
      response.on('end', () => done(response.statusCode!));
    });
    request.write('a'.repeat(700));
    request.end('b'.repeat(700));
  });
}

async function checkHttp(origin: string): Promise<void> {
  // This direct submission precedes every page GET: registration cannot depend on rendering.
  const form = new URLSearchParams({ name: 'Direct POST' });
  const direct = await fetch(`${origin}/actions/greet`, {
    method: 'POST',
    headers: { Origin: origin },
    body: form,
    redirect: 'manual',
  });
  assert.equal(direct.status, 303);
  assert.match(direct.headers.get('location')!, /greeting\?name=Direct\+POST&submitted=1$/);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(`${origin}/actions/probe`, {
      method,
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{"value":1}',
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"value":1}');
    assert.equal(response.headers.get('x-action-probe'), 'PURITY_ACTION_HANDLER_PRIVATE_MARKER');
    assert.equal(response.headers.getSetCookie().length, 2);
  }
  for (const originHeader of [undefined, 'null', 'https://other.example']) {
    const headers: Record<string, string> = {};
    if (originHeader !== undefined) headers.Origin = originHeader;
    assert.equal(
      (await fetch(`${origin}/actions/probe`, { method: 'POST', headers, body: 'blocked' })).status,
      403,
    );
  }
  assert.equal(
    (
      await fetch(`${origin}/actions/probe`, {
        method: 'POST',
        headers: { Origin: origin },
        body: 'x'.repeat(1025),
      })
    ).status,
    413,
  );
  assert.equal(await chunkedSubmission(origin), 413);
  assert.equal(
    (await fetch(`${origin}/actions/missing`, { method: 'POST', headers: { Origin: origin } }))
      .status,
    404,
  );
  assert.equal((await fetch(`${origin}/actions/probe`)).status, 404);
  const head = await fetch(`${origin}/greeting`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  console.log(
    'HTTP: direct registration, methods, cookies, origin checks, body limits, and HEAD passed',
  );
}

async function checkBrowser(engine: BrowserType, origin: string): Promise<void> {
  const browser = await engine.launch();
  const diagnostics: string[] = [];
  try {
    const native = await browser.newContext({ javaScriptEnabled: false });
    const page = await native.newPage();
    assert.equal((await page.goto(`${origin}/greeting`))?.status(), 200);
    await page.getByLabel('Your name').fill('   ');
    const invalidPage = page.waitForResponse(
      (response) => response.request().method() === 'GET' && response.url().includes('error=1'),
    );
    await page.getByRole('button', { name: 'Send greeting' }).click();
    assert.equal((await invalidPage).status(), 422);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Your name').getAttribute('aria-invalid'), 'true');
    await page.getByLabel('Your name').fill('Ada');
    const submission = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/actions/greet'),
    );
    await page.getByRole('button', { name: 'Send greeting' }).click();
    assert.equal((await submission).status(), 303);
    await page.getByRole('status').waitFor();
    assert.equal(await page.getByRole('status').textContent(), 'Hello, Ada!');
    await native.close();

    const enhanced = await browser.newPage();
    const errors: string[] = [];
    enhanced.on('pageerror', (error) => errors.push(error.message));
    enhanced.on('console', (message) => {
      diagnostics.push(message.text());
      if (diagnostics.length > 20) diagnostics.shift();
    });
    await enhanced.goto(`${origin}/greeting`);
    await enhanced.waitForLoadState('networkidle');
    await enhanced.evaluate(() => {
      document.body.dataset.documentProbe = 'same-document';
    });
    await enhanced.getByLabel('Your name').fill('   ');
    const invalid = enhanced.waitForResponse(
      (response) =>
        response.url().endsWith('/actions/greet') && response.request().method() === 'POST',
    );
    await enhanced.getByRole('button', { name: 'Send greeting' }).click();
    assert.equal((await invalid).status(), 422);
    await enhanced.getByRole('alert').waitFor();
    assert.equal(await enhanced.getByLabel('Your name').inputValue(), '   ');
    assert.equal(await enhanced.getByLabel('Your name').getAttribute('aria-invalid'), 'true');
    assert.equal(
      await enhanced.getByLabel('Your name').evaluate((input) => input === document.activeElement),
      true,
    );
    const errorId = (await enhanced.getByLabel('Your name').getAttribute('aria-describedby'))!
      .split(' ')
      .at(-1)!;
    assert.equal(
      await enhanced.locator(`[id="${errorId}"]`).textContent(),
      'Enter a name between 1 and 80 characters.',
    );
    await enhanced.getByLabel('Your name').fill('Ada');
    await enhanced.getByRole('button', { name: 'Send greeting' }).click();
    await enhanced.waitForFunction(
      () => document.querySelector('[data-purity-form-status]')?.textContent === 'Hello, Ada!',
    );
    assert.equal(await enhanced.getByLabel('Your name').getAttribute('aria-invalid'), null);
    assert.equal(await enhanced.getByLabel('Your name').inputValue(), 'Ada');
    assert.equal(await enhanced.getByRole('status').textContent(), 'Hello, Ada!');
    assert.equal(
      await enhanced.evaluate(() => document.body.dataset.documentProbe),
      'same-document',
    );

    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    let requests = 0;
    await enhanced.route('**/actions/greet', async (route) => {
      requests++;
      await held;
      await route.continue();
    });
    await enhanced.getByLabel('Your name').fill('Pending');
    // Exercise implicit submission while holding the response to inspect state.
    await enhanced.evaluate(() => document.querySelector('form')!.requestSubmit());
    await enhanced.locator('form[data-purity-pending]').waitFor();
    assert.equal(await enhanced.locator('form').getAttribute('aria-busy'), 'true');
    assert.equal(await enhanced.getByRole('button', { name: 'Send greeting' }).isDisabled(), true);
    await enhanced.evaluate(() => document.querySelector('form')!.requestSubmit());
    assert.equal(await enhanced.getByRole('status').textContent(), 'Submitting…');
    release();
    await enhanced.waitForFunction(
      () => document.querySelector('[data-purity-form-status]')?.textContent === 'Hello, Pending!',
    );
    assert.equal(requests, 1, 'A duplicate submission reached the server');
    assert.equal(await enhanced.getByRole('button', { name: 'Send greeting' }).isDisabled(), false);
    assert.equal(await enhanced.locator('form').getAttribute('aria-busy'), null);
    await enhanced.unroute('**/actions/greet');

    await enhanced.route('**/actions/greet', (route) => route.abort('failed'));
    await enhanced.getByLabel('Your name').fill('Retry');
    await enhanced.getByRole('button', { name: 'Send greeting' }).click();
    await enhanced.getByRole('alert').waitFor();
    assert.match((await enhanced.getByRole('alert').textContent())!, /try again/);
    assert.equal(await enhanced.getByLabel('Your name').inputValue(), 'Retry');
    await enhanced.unroute('**/actions/greet');
    await enhanced.getByRole('button', { name: 'Send greeting' }).click();
    await enhanced.waitForFunction(
      () => document.querySelector('[data-purity-form-status]')?.textContent === 'Hello, Retry!',
    );

    const results = await enhanced.evaluate(async () => {
      const submit = async (name: string) => {
        const body = new FormData();
        body.set('name', name);
        const response = await fetch('/actions/greet', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body,
        });
        return {
          status: response.status,
          data: await response.json(),
          redirected: response.redirected,
        };
      };
      return { valid: await submit('Grace'), invalid: await submit('') };
    });
    assert.deepEqual(results, {
      valid: { status: 200, data: { message: 'Hello, Grace!' }, redirected: false },
      invalid: {
        status: 422,
        data: {
          message: 'Enter a name between 1 and 80 characters.',
          fieldErrors: { name: 'Enter a name between 1 and 80 characters.' },
        },
        redirected: false,
      },
    });
    // A response arriving after route removal must never update the old form.
    let finishLate!: () => void;
    const late = new Promise<void>((done) => {
      finishLate = done;
    });
    let started!: () => void;
    const startedRequest = new Promise<void>((done) => {
      started = done;
    });
    await enhanced.route('**/actions/greet', async (route) => {
      started();
      await late;
      await route.fulfill({ contentType: 'application/json', body: '{"message":"Late response"}' });
    });
    await enhanced.getByLabel('Your name').fill('Removed');
    await enhanced.evaluate(() => document.querySelector('form')!.requestSubmit());
    await startedRequest;
    await enhanced.evaluate(() => {
      const form = document.querySelector('form')!;
      form.remove();
      // Retain only in this test so we can detect a late write to detached DOM.
      (globalThis as typeof globalThis & { removedForm?: HTMLFormElement }).removedForm = form;
    });
    finishLate();
    await enhanced.unrouteAll({ behavior: 'wait' });
    await enhanced.waitForFunction(
      () =>
        !(
          globalThis as typeof globalThis & { removedForm?: HTMLFormElement }
        ).removedForm!.hasAttribute('aria-busy'),
    );
    assert.equal(
      await enhanced.evaluate(() =>
        (
          globalThis as typeof globalThis & { removedForm?: HTMLFormElement }
        ).removedForm!.textContent?.includes('Late response'),
      ),
      false,
    );
    assert.equal(
      await enhanced.evaluate(() => document.body.dataset.documentProbe),
      'same-document',
    );
    assert.deepEqual(errors, []);
    console.log(
      `${engine.name()}: native no-JS forms, in-place validation/focus, pending/deduplication, network retry, removal, and multipart JSON passed`,
    );
  } catch (error) {
    console.error(diagnostics.join('\n'));
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        console.error(`${engine.name()} form probe failed at ${page.url()}`);
        console.error(
          await page
            .locator('body')
            .innerText()
            .catch(() => 'Page unavailable'),
        );
      }
    }
    throw error;
  } finally {
    await browser.close();
  }
}

const scratch = await mkdtemp(join(tmpdir(), 'purity-app-actions-'));
const target = await realpath(scratch);
assert.equal(dirname(target), await realpath(tmpdir()));
assert.ok(basename(target).startsWith('purity-app-actions-'));
try {
  const tarballs = new Map<string, string>();
  for (const pkg of ['@purityjs/core', '@purityjs/ssr', '@purityjs/vite-plugin', '@purityjs/cli']) {
    const output = await run(
      [npmCli!, 'pack', '--json', '--pack-destination', target, '-w', pkg],
      repo,
    );
    const packed = JSON.parse(output) as
      | Array<{ filename: string }>
      | Record<string, { filename: string }>;
    const info = Array.isArray(packed) ? packed[0] : packed[pkg];
    assert.ok(info?.filename);
    tarballs.set(pkg, join(target, info.filename));
  }
  await run(
    [
      npmCli!,
      'exec',
      '--yes',
      `--package=${tarballs.get('@purityjs/cli')}`,
      '--',
      'purity',
      'app',
      '--app',
    ],
    target,
  );
  const project = join(target, 'app');
  const manifestPath = join(project, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const pkg of ['@purityjs/core', '@purityjs/ssr', '@purityjs/vite-plugin']) {
    const deps = pkg === '@purityjs/vite-plugin' ? manifest.devDependencies : manifest.dependencies;
    deps[pkg] = `file:${tarballs.get(pkg)}`;
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(
    join(project, 'src/actions/probe.server.ts'),
    "import { serverAction } from '@purityjs/core';\n" +
      "export const probe = serverAction('/actions/probe', async (request) => {\n" +
      "  const headers = new Headers({ 'X-Action-Probe': 'PURITY_ACTION_HANDLER_PRIVATE_MARKER' });\n" +
      "  headers.append('Set-Cookie', 'first=1; Path=/; HttpOnly');\n" +
      "  headers.append('Set-Cookie', 'second=2; Path=/; HttpOnly');\n" +
      '  return new Response(await request.text(), { headers });\n' +
      '});\n',
  );
  await run([npmCli!, 'install', '--no-audit', '--no-fund'], project);
  await run([npmCli!, 'run', 'build'], project);
  for (const file of await readdir(join(project, 'dist/client/assets'))) {
    if (file.endsWith('.js')) {
      assert.ok(
        !(await readFile(join(project, 'dist/client/assets', file), 'utf8')).includes(
          'PURITY_ACTION_HANDLER_PRIVATE_MARKER',
        ),
        'Action handler leaked into client bundle',
      );
    }
  }
  for (const mode of ['dev', 'start']) {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = launch([npmCli!, 'run', mode], project, {
      ...npmEnv,
      PORT: String(port),
      PUBLIC_ORIGIN: origin,
      TRUST_PROXY: '0',
      MAX_ACTION_BODY_BYTES: '1024',
    });
    try {
      for (let attempt = 0; !server.output().includes('Purity app listening'); attempt++) {
        assert.ok(attempt < 100 && server.child.exitCode === null, server.output());
        await delay(100);
      }
      console.log(`Checking ${mode}`);
      await checkHttp(origin);
      for (const engine of [chromium, firefox, webkit]) await checkBrowser(engine, origin);
      if (mode === 'dev') {
        await rm(join(project, 'src/actions/probe.server.ts'));
        for (let attempt = 0; ; attempt++) {
          const response = await fetch(`${origin}/actions/probe`, {
            method: 'POST',
            headers: { Origin: origin },
          });
          await response.text();
          if (response.status === 404) break;
          assert.ok(attempt < 50, 'Deleted action remained callable after Vite reload');
          await delay(100);
        }
        console.log('Development: deleting an action removed its endpoint');
      }
    } finally {
      await stop(server.child);
    }
  }
} finally {
  await rm(target, { recursive: true, force: true });
}
