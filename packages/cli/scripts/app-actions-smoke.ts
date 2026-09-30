#!/usr/bin/env node
// Exercise a packaged --app project in development and production.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';
import { createServer, type Socket } from 'node:net';
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
  const redirect = await fetch(`${origin}/actions/redirect-probe`, {
    method: 'POST',
    headers: { Origin: origin },
    redirect: 'manual',
  });
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), `${origin}/greeting?name=Redirect&submitted=1`);
  const head = await fetch(`${origin}/greeting`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  console.log(
    'HTTP: direct registration, methods, cookies, origin checks, body limits, and HEAD passed',
  );
}

type DisconnectState = Record<
  string,
  {
    started: boolean;
    aborted: boolean;
    requestAborted?: boolean;
    reasonName?: string;
    reasonCode?: string;
    reasonPhase?: string;
    reasonTimeout?: number;
    completed: boolean;
    views: number;
  }
>;

async function disconnectState(
  origin: string,
  id: string,
  release = false,
): Promise<DisconnectState> {
  const response = await fetch(`${origin}/actions/disconnect-state`, {
    method: 'POST',
    headers: { Origin: origin },
    body: new URLSearchParams({ id, release: String(release) }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function checkRenderTimeouts(origin: string): Promise<void> {
  for (const method of ['GET', 'HEAD']) {
    const id = `render-timeout-${method}`;
    const response = await fetch(`${origin}/disconnect/probe?id=${id}&mode=render-timeout`, {
      method,
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('retry-after'), null);
    assert.equal(await response.text(), method === 'HEAD' ? '' : 'Service Unavailable');
    const state = await disconnectState(origin, id);
    for (const phase of ['page', 'layout']) {
      assert.equal(state[phase].aborted, true);
      assert.equal(state[phase].requestAborted, false);
      assert.equal(state[phase].reasonName, 'SSRTimeoutError');
      assert.equal(state[phase].reasonCode, 'PURITY_SSR_TIMEOUT');
      assert.equal(state[phase].reasonPhase, 'shell');
      assert.equal(state[phase].reasonTimeout, 100);
      assert.equal(state[phase].completed, false);
    }
    await disconnectState(origin, id, true);
    assert.equal((await disconnectState(origin, id)).page.completed, false);
  }
  const error = await fetch(`${origin}/timeout-lookalike`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(error.status, 500);
  assert.equal(await error.text(), 'Internal Server Error');
  assert.equal((await fetch(`${origin}/greeting`)).status, 200);
  console.log(
    'HTTP SSR deadlines: GET/HEAD 503, no-store, typed page/layout cancellation, no leaked details, ordinary error 500, and next-request recovery passed',
  );
}

async function until(check: () => boolean | Promise<boolean>, message: string): Promise<void> {
  for (let attempt = 0; !(await check()); attempt++) {
    assert.ok(attempt < 100, message);
    await delay(100);
  }
}

function openRequest(url: string, agent: Agent | false = false) {
  let body = '';
  let disconnected = false;
  let error: Error | undefined;
  const request = httpRequest(url, { agent });
  const ended = new Promise<void>((done) => {
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => (body += chunk.toString()));
      response.on('end', done);
      response.on('error', (cause: Error) => {
        if (!disconnected) error = cause;
      });
    });
  });
  const closed = new Promise<void>((done) => request.once('close', done));
  request.on('error', (cause: Error) => {
    if (!disconnected) error = cause;
  });
  request.end();
  return {
    request,
    body: () => body,
    error: () => error,
    ended,
    closed,
    disconnect: () => {
      disconnected = true;
      request.destroy();
    },
  };
}

async function checkDisconnects(origin: string, output: () => string): Promise<void> {
  const upload = httpRequest(`${origin}/actions/probe?partial=1`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Length': '100' },
  });
  upload.on('error', () => {}); // Destroying our partial upload intentionally resets its socket.
  const uploadClosed = new Promise<void>((done) => upload.once('close', done));
  try {
    upload.write('partial');
    await until(
      () => output().includes('PURITY_UPLOAD:/actions/probe?partial=1'),
      'Upload body reader did not start',
    );
    upload.destroy();
    await uploadClosed;
    await until(
      () => output().includes('PURITY_DISCONNECT:/actions/probe?partial=1'),
      'Incomplete upload did not cancel',
    );
  } finally {
    upload.destroy();
  }
  // The test-only route lookup is gated, so close the actual TCP connection
  // before rendering starts and observe the adapter's cancellation barrier.
  const early = openRequest(`${origin}/disconnect/early?id=early`);
  try {
    await until(
      async () => !!(await disconnectState(origin, 'early')).routing?.started,
      'Route lookup did not start',
    );
    early.disconnect();
    await early.closed;
    await until(
      () => output().includes('PURITY_DISCONNECT:/disconnect/early?id=early'),
      'Early disconnect was not observed',
    );
    await disconnectState(origin, 'early', true);
    await until(
      async () => !!(await disconnectState(origin, 'early')).routing?.completed,
      'Route lookup did not settle',
    );
    assert.equal(
      (await disconnectState(origin, 'early')).page,
      undefined,
      'Rendering started after disconnect',
    );
  } finally {
    early.disconnect();
  }

  for (const mode of ['shell', 'stream']) {
    const id = `cancel-${mode}`;
    const client = openRequest(`${origin}/disconnect/probe?id=${id}&mode=${mode}`);
    try {
      const phases = mode === 'shell' ? ['page', 'layout'] : ['boundary'];
      await until(async () => {
        const state = await disconnectState(origin, id);
        return phases.every((phase) => state[phase]?.started);
      }, `${mode} work did not start`);
      if (mode === 'stream') {
        await until(
          () => client.body().includes('Waiting for deferred content'),
          'SSR shell was not received',
        );
      } else assert.equal(client.body(), '', 'Shell should wait for page and layout loaders');
      assert.equal(client.error(), undefined);
      client.disconnect();
      await client.closed;
      await until(async () => {
        const state = await disconnectState(origin, id);
        return phases.every((phase) => state[phase]?.aborted && !state[phase].completed);
      }, `${mode} work did not cancel`);
      await disconnectState(origin, id, true);
      const state = await disconnectState(origin, id);
      assert.ok(phases.every((phase) => !state[phase].completed));
      if (mode === 'shell') assert.equal(state.page.views, 0);
    } finally {
      client.disconnect();
    }
  }

  for (const mode of ['boundary-timeout', 'loader-boundary-timeout']) {
    const phases = mode === 'boundary-timeout' ? ['expired'] : ['expired-page', 'expired-layout'];
    const boundaryClient = openRequest(`${origin}/disconnect/probe?id=${mode}&mode=${mode}`);
    try {
      await until(async () => {
        const state = await disconnectState(origin, mode);
        return phases.every((phase) => state[phase]?.aborted) && !!state.neighbor?.started;
      }, 'Boundary deadline did not cancel its work before the neighbor completed');
      const state = await disconnectState(origin, mode);
      for (const phase of phases) {
        assert.ok(!state[phase].completed);
        assert.equal(state[phase].reasonName, 'TimeoutError');
        if (mode === 'loader-boundary-timeout') assert.equal(state[phase].requestAborted, false);
      }
      assert.ok(!state.neighbor.aborted && !state.neighbor.completed);
      await disconnectState(origin, mode, true);
      await until(
        () => boundaryClient.body().includes('Finished loader'),
        'Healthy neighbor did not stream its result',
      );
      await boundaryClient.ended;
      assert.equal(boundaryClient.error(), undefined);
      const finished = await disconnectState(origin, mode);
      assert.ok(phases.every((phase) => !finished[phase].completed));
      assert.ok(finished.neighbor.completed && !finished.neighbor.aborted);
    } finally {
      boundaryClient.disconnect();
    }
  }

  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  try {
    let previousSocket: Socket | undefined;
    for (const id of ['healthy', 'reused']) {
      const client = openRequest(`${origin}/disconnect/probe?id=${id}&mode=shell`, agent);
      await until(async () => {
        const state = await disconnectState(origin, id);
        return !!(state.page?.started && state.layout?.started);
      }, 'Healthy request did not start');
      const state = await disconnectState(origin, id);
      assert.ok(
        !state.page.aborted && !state.layout.aborted,
        'Receiving the GET incorrectly canceled SSR',
      );
      if (previousSocket) assert.equal(client.request.socket, previousSocket);
      previousSocket = client.request.socket ?? undefined;
      await disconnectState(origin, id, true);
      const timeout = new AbortController();
      try {
        await Promise.race([
          client.ended,
          delay(10_000, undefined, { signal: timeout.signal }).then(() => {
            throw new Error('Healthy response did not end');
          }),
        ]);
      } finally {
        timeout.abort();
      }
      assert.equal(client.error(), undefined);
      assert.match(client.body(), /Finished loader/);
      const finished = await disconnectState(origin, id);
      assert.ok(finished.page.completed && finished.layout.completed);
      assert.ok(
        !finished.page.aborted && !finished.layout.aborted,
        'Successful response incorrectly canceled SSR',
      );
    }
  } finally {
    agent.destroy();
  }
  await assert.rejects(
    fetch(`${origin}/actions/broken-stream`, {
      method: 'POST',
      headers: { Origin: origin },
      signal: AbortSignal.timeout(10_000),
    }),
  );
  await until(
    () => output().includes('PURITY_EXPECTED_STREAM_FAILURE'),
    'A genuine stream failure was swallowed',
  );
  console.log(
    'HTTP disconnects: incomplete upload, early lookup, page/layout loaders, deferred stream, isolated resource/loader boundary timeouts, and healthy keep-alive reuse passed',
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
    await enhanced.evaluate(() =>
      (globalThis as typeof globalThis & { installQueryProbe: () => void }).installQueryProbe(),
    );
    await enhanced.waitForFunction(
      () => document.querySelector('#query-value')?.textContent !== '',
    );
    const baseline = Number(await enhanced.locator('#query-value').textContent());
    assert.equal(await enhanced.locator('#query-reads').textContent(), '1');
    assert.equal(await enhanced.locator('#other-reads').textContent(), '1');
    const submitQuery = async (value: string) => {
      await enhanced.getByLabel('Query value').fill(value);
      await enhanced.getByRole('button', { name: 'Save query value' }).click();
      await enhanced.waitForFunction(
        () => !document.querySelector('#query-form')!.hasAttribute('aria-busy'),
      );
    };
    await submitQuery('valid');
    await enhanced.waitForFunction(
      (value) => document.querySelector('#query-value')?.textContent === String(value),
      baseline + 1,
    );
    assert.equal(await enhanced.locator('#query-reads').textContent(), '2');
    assert.equal(await enhanced.getByRole('status').textContent(), 'Saved value.');
    await submitQuery('invalid');
    await enhanced.getByRole('alert').waitFor();
    assert.equal(await enhanced.locator('#query-value').textContent(), String(baseline + 1));
    assert.equal(await enhanced.locator('#query-reads').textContent(), '2');
    assert.equal(
      await enhanced
        .getByLabel('Query value')
        .evaluate((input) => input === document.activeElement),
      true,
    );
    await submitQuery('failread');
    await enhanced.waitForFunction(
      () => document.querySelector('#query-error')?.textContent === 'Query read failed',
    );
    assert.equal(await enhanced.getByRole('status').textContent(), 'Saved value.');
    assert.equal(await enhanced.locator('#query-value').textContent(), String(baseline + 1));
    assert.equal(await enhanced.locator('#query-reads').textContent(), '3');
    await submitQuery('recovery');
    await enhanced.waitForFunction(
      (value) => document.querySelector('#query-value')?.textContent === String(value),
      baseline + 3,
    );
    assert.equal(await enhanced.locator('#query-error').textContent(), '');
    assert.equal(await enhanced.locator('#query-reads').textContent(), '4');
    assert.equal(await enhanced.locator('#other-reads').textContent(), '1');
    assert.equal(
      await enhanced.evaluate(() => document.body.dataset.documentProbe),
      'same-document',
    );
    assert.deepEqual(errors, []);
    await enhanced
      .locator('#query-form')
      .evaluate((form) => form.setAttribute('action', '/actions/redirect-probe'));
    await submitQuery('external');
    assert.equal(await enhanced.getByRole('status').textContent(), 'Saved redirect.');
    assert.equal(
      await enhanced.evaluate(() => document.body.dataset.documentProbe),
      'same-document',
    );
    const destination = enhanced.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().endsWith('/greeting?name=Redirect&submitted=1'),
    );
    await enhanced.getByLabel('Query value').fill('redirect');
    await enhanced.getByRole('button', { name: 'Save query value' }).click();
    assert.equal((await destination).status(), 200);
    await enhanced.waitForURL(`${origin}/greeting?name=Redirect&submitted=1`);
    await enhanced.getByRole('status').waitFor();
    assert.equal(await enhanced.getByRole('status').textContent(), 'Hello, Redirect!');
    assert.equal(await enhanced.getByLabel('Your name').inputValue(), 'Redirect');
    assert.equal(await enhanced.evaluate(() => document.body.dataset.documentProbe), undefined);
    await enhanced.waitForLoadState('networkidle');
    const slowRequest = enhanced.waitForRequest((request) =>
      request.url().endsWith('/actions/slow-read'),
    );
    await enhanced.evaluate(() =>
      (globalThis as typeof globalThis & { installRouteProbe: () => void }).installRouteProbe(),
    );
    await slowRequest;
    const cancelled = enhanced.waitForEvent('requestfailed', {
      predicate: (request) => request.url().endsWith('/actions/slow-read'),
    });
    await enhanced.getByRole('button', { name: 'Leave slow route' }).click();
    await cancelled;
    await enhanced.waitForFunction(
      () => document.querySelector('#route-state')?.textContent === 'aborted',
    );
    assert.equal(await enhanced.locator('#route-host').textContent(), 'Next route');
    assert.deepEqual(errors, []);
    console.log(
      `${engine.name()}: native no-JS forms, in-place validation/focus, pending/deduplication, network retry, removal, multipart JSON, action query invalidation, enhanced redirect, and route loader cancellation passed`,
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
  const serverPath = join(project, 'server.ts');
  const serverSource = await readFile(serverPath, 'utf8');
  assert.ok(serverSource.includes('const abort = new AbortController();'));
  assert.ok(
    serverSource.includes(
      'async function readActionBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {',
    ),
  );
  await writeFile(
    serverPath,
    serverSource
      .replace(
        'const abort = new AbortController();',
        "const abort = new AbortController();\n    abort.signal.addEventListener('abort', () => console.log('PURITY_DISCONNECT:' + req.url), { once: true });",
      )
      .replace(
        'async function readActionBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {',
        "async function readActionBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {\n  if (req.url?.includes('partial=1')) console.log('PURITY_UPLOAD:' + req.url);",
      ),
  );
  const manifestPath = join(project, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const pkg of ['@purityjs/core', '@purityjs/ssr', '@purityjs/vite-plugin']) {
    const deps = pkg === '@purityjs/vite-plugin' ? manifest.devDependencies : manifest.dependencies;
    deps[pkg] = `file:${tarballs.get(pkg)}`;
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(
    join(project, 'src/disconnect-probe.ts'),
    `
type Work = { signal?: AbortSignal; requestSignal?: AbortSignal; completed: boolean; views: number; release: () => void };
const records = new Map<string, Map<string, Work>>();
export function waitForDisconnect(id: string, phase: string, signal?: AbortSignal, requestSignal?: AbortSignal): Promise<string> {
  let phases = records.get(id);
  if (!phases) records.set(id, phases = new Map());
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal?.removeEventListener('abort', onAbort); reject(signal?.reason); };
    const work: Work = { signal, requestSignal, completed: false, views: 0, release: () => {
      if (signal?.aborted) return;
      signal?.removeEventListener('abort', onAbort);
      work.completed = true;
      resolve('Finished loader');
    } };
    phases!.set(phase, work);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
export function markView(id: string): void { const work = records.get(id)?.get('page'); if (work) work.views++; }
export function inspectDisconnect(id: string, release: boolean) {
  const phases = records.get(id);
  if (release) for (const work of phases?.values() ?? []) work.release();
  return Object.fromEntries(Array.from(phases ?? [], ([phase, work]) => [phase, {
    started: true, aborted: work.signal?.aborted ?? false, requestAborted: work.requestSignal?.aborted,
    reasonName: work.signal?.reason?.name, reasonCode: work.signal?.reason?.code,
    reasonPhase: work.signal?.reason?.phase, reasonTimeout: work.signal?.reason?.timeout,
    completed: work.completed, views: work.views,
  }]));
}
`,
  );
  await writeFile(
    join(project, 'src/actions/disconnect.server.ts'),
    `
import { serverAction } from '@purityjs/core';
import { inspectDisconnect } from '../disconnect-probe.ts';
export const disconnectState = serverAction('/actions/disconnect-state', async (request) => {
  const form = await request.formData();
  return Response.json(inspectDisconnect(String(form.get('id')), form.get('release') === 'true'));
});
`,
  );
  await mkdir(join(project, 'src/pages/disconnect'), { recursive: true });
  const disconnectPage = `
import { asyncRoute, html, resource, suspense, type AsyncRouteEntry, type LoaderContext } from '@purityjs/core';
import { markView, waitForDisconnect } from '../../disconnect-probe.ts';
export async function loader({ request, signal }: LoaderContext) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id')!;
  const mode = url.searchParams.get('mode');
  if (!['stream', 'boundary-timeout', 'loader-boundary-timeout'].includes(mode!)) await waitForDisconnect(id, 'page', signal, request.signal);
  return { id, mode };
}
export default function Probe(_params: unknown, data: { id: string; mode: string | null }) {
  markView(data.id);
  if (data.mode === 'loader-boundary-timeout') {
    const entry: AsyncRouteEntry = {
      pattern: '/deferred-probe', filePath: 'deferred-probe.ts', hasLoader: true,
      importFn: async () => ({
        default: (_params: unknown, value: string) => html\`<p>\${value}</p>\`,
        loader: ({ signal, request }: LoaderContext) => waitForDisconnect(data.id, 'expired-page', signal, request.signal),
      }),
      layouts: [{
        filePath: 'deferred-layout.ts', hasLoader: true,
        importFn: async () => ({
          default: (children: () => unknown) => children(),
          loader: ({ signal, request }: LoaderContext) => waitForDisconnect(data.id, 'expired-layout', signal, request.signal),
        }),
      }],
    };
    return html\`<main>Loader boundary shell \${suspense(() => asyncRoute(entry, {}),
      () => html\`<p>Timed loader fallback</p>\`, { timeout: 100 })}\${suspense(() => {
      const value = resource(({ signal }) => waitForDisconnect(data.id, 'neighbor', signal), { key: 'neighbor' });
      return html\`<p>\${() => value()}</p>\`;
    }, () => html\`<p>Healthy neighbor fallback</p>\`)}</main>\`;
  }
  if (data.mode === 'boundary-timeout') return html\`<main>Boundary timeout shell \${suspense(() => {
    const value = resource(({ signal }) => waitForDisconnect(data.id, 'expired', signal), { key: 'expired' });
    return html\`<p>\${() => value()}</p>\`;
  }, () => html\`<p>Timed boundary fallback</p>\`, { timeout: 100 })}\${suspense(() => {
    const value = resource(({ signal }) => waitForDisconnect(data.id, 'neighbor', signal), { key: 'neighbor' });
    return html\`<p>\${() => value()}</p>\`;
  }, () => html\`<p>Healthy neighbor fallback</p>\`)}</main>\`;
  if (data.mode !== 'stream') return html\`<p>Finished loader</p>\`;
  return html\`<main>Stream shell \${suspense(() => {
    const value = resource(({ signal }) => waitForDisconnect(data.id, 'boundary', signal));
    return html\`<p>\${() => value()}</p>\`;
  }, () => html\`<p>Waiting for deferred content</p>\`)}</main>\`;
}
`;
  await writeFile(join(project, 'src/pages/disconnect/probe.ts'), disconnectPage);
  await writeFile(join(project, 'src/pages/disconnect/early.ts'), disconnectPage);
  await writeFile(
    join(project, 'src/pages/disconnect/_layout.ts'),
    `
import { type LoaderContext } from '@purityjs/core';
import { waitForDisconnect } from '../../disconnect-probe.ts';
export async function loader({ request, signal }: LoaderContext) {
  const url = new URL(request.url);
  if (!['stream', 'boundary-timeout', 'loader-boundary-timeout'].includes(url.searchParams.get('mode')!)) await waitForDisconnect(url.searchParams.get('id')!, 'layout', signal, request.signal);
}
export default function Layout(children: () => unknown) { return children(); }
`,
  );
  const serverEntryPath = join(project, 'src/entry.server.ts');
  await writeFile(
    serverEntryPath,
    "import { waitForDisconnect } from './disconnect-probe.ts';\n" +
      (await readFile(serverEntryPath, 'utf8'))
        .replace('export async function routeFor(', 'async function originalRouteFor(')
        .replace(
          '{ request, signal: request.signal, nonce }',
          "{ request, signal: request.signal, nonce, timeout: new URL(request.url).searchParams.get('mode') === 'render-timeout' ? 100 : undefined }",
        ) +
      `
export async function routeFor(path: string) {
  if (path === '/disconnect/early') await waitForDisconnect('early', 'routing');
  return originalRouteFor(path);
}
`,
  );
  await writeFile(
    join(project, 'src/pages/timeout-lookalike.ts'),
    `
export default function TimeoutLookalike(): never {
  const error = new Error('PURITY_EXPECTED_LOOKALIKE: renderToStream shell timed out after 100ms');
  error.name = 'SSRTimeoutError';
  throw error;
}
`,
  );
  await writeFile(
    join(project, 'src/actions/probe.server.ts'),
    "import { serverAction } from '@purityjs/core';\n" +
      "export const probe = serverAction('/actions/probe', async (request) => {\n" +
      "  const headers = new Headers({ 'X-Action-Probe': 'PURITY_ACTION_HANDLER_PRIVATE_MARKER' });\n" +
      "  headers.append('Set-Cookie', 'first=1; Path=/; HttpOnly');\n" +
      "  headers.append('Set-Cookie', 'second=2; Path=/; HttpOnly');\n" +
      '  return new Response(await request.text(), { headers });\n' +
      '});\n' +
      `let value = 0;
let failNextRead = false;
export const queryRead = serverAction('/actions/query-read', () => {
  if (failNextRead) {
    failNextRead = false;
    return Response.json({ message: 'Query read failed' }, { status: 503 });
  }
  return Response.json({ value });
});
export const queryWrite = serverAction('/actions/query-write', async (request) => {
  const input = (await request.formData()).get('value');
  if (input === 'invalid') return Response.json({
    message: 'Check value.', fieldErrors: { value: 'Invalid value' },
    invalidate: [['query-counter']],
  }, { status: 422 });
  value++;
  failNextRead = input === 'failread';
  return Response.json({ message: 'Saved value.', invalidate: [['query-counter'], ['query-counter']] });
});
export const redirectProbe = serverAction('/actions/redirect-probe', async (request) => {
  const destination = new URL('/greeting?name=Redirect&submitted=1', request.url);
  if (request.headers.get('accept')?.includes('application/json')) {
    const input = (await request.formData()).get('value');
    return Response.json({ message: 'Saved redirect.', redirect: input === 'external' ? 'https://other.example/' : destination.href });
  }
  return Response.redirect(destination, 303);
});
export const slowRead = serverAction('/actions/slow-read', async () => {
  await new Promise((done) => setTimeout(done, 1000));
  return Response.json({ value: 'Late route' });
});
export const brokenStream = serverAction('/actions/broken-stream', () => new Response(new ReadableStream({
  start(controller) { controller.error(new Error('PURITY_EXPECTED_STREAM_FAILURE')); },
})));
`,
  );
  await writeFile(
    join(project, 'src/query-probe.ts'),
    `import { asyncRoute, mount, query, watch, type AsyncRouteEntry, type LoaderContext } from '@purityjs/core';
export function installQueryProbe() {
  const section = document.createElement('section');
  section.innerHTML = '<form id="query-form" action="/actions/query-write" method="post" data-purity-enhance><label>Query value<input name="value"></label><button>Save query value</button><p data-purity-form-status></p></form><span id="query-value"></span><span id="query-reads"></span><span id="query-error"></span><span id="other-reads"></span>';
  document.getElementById('app')!.append(section);
  let reads = 0;
  const data = query({
    key: ['query-counter'], staleTime: 60_000,
    revalidateOnVisible: false, revalidateOnReconnect: false, revalidateOnBfcacheRestore: false,
    fetcher: async (_params, { signal }) => {
      section.querySelector('#query-reads')!.textContent = String(++reads);
      const response = await fetch('/actions/query-read', { method: 'POST', signal });
      if (!response.ok) throw new Error('Query read failed');
      return (await response.json()).value as number;
    },
  });
  let otherReads = 0;
  const other = query({
    key: 'query-other', staleTime: 60_000,
    revalidateOnVisible: false, revalidateOnReconnect: false, revalidateOnBfcacheRestore: false,
    fetcher: async () => ++otherReads,
  });
  watch(() => {
    section.querySelector('#query-value')!.textContent = String(data() ?? '');
    const error = data.error();
    section.querySelector('#query-error')!.textContent = error instanceof Error ? error.message : '';
    section.querySelector('#other-reads')!.textContent = String(other() ?? '');
  });
}
export function installRouteProbe() {
  const section = document.createElement('section');
  section.innerHTML = '<button>Leave slow route</button><p id="route-state"></p><div id="route-host"></div>';
  document.getElementById('app')!.append(section);
  const entry: AsyncRouteEntry = {
    pattern: '/slow-probe', filePath: 'slow-probe.ts', hasLoader: true, layouts: [],
    importFn: async () => ({
      default: () => document.createTextNode('Late route'),
      loader: async ({ signal }: LoaderContext) => {
        signal.addEventListener('abort', () => { section.querySelector('#route-state')!.textContent = 'aborted'; }, { once: true });
        const response = await fetch('/actions/slow-read', { method: 'POST', signal });
        return response.json();
      },
    }),
  };
  const host = section.querySelector('#route-host')!;
  const mounted = mount(() => asyncRoute(entry, {}) as DocumentFragment, host);
  section.querySelector('button')!.addEventListener('click', () => {
    mounted.unmount();
    host.textContent = 'Next route';
  });
}
`,
  );
  const entryPath = join(project, 'src/entry.client.ts');
  await writeFile(
    entryPath,
    "import { installQueryProbe, installRouteProbe } from './query-probe.ts';\n" +
      '(globalThis as typeof globalThis & { installQueryProbe?: () => void }).installQueryProbe = installQueryProbe;\n' +
      '(globalThis as typeof globalThis & { installRouteProbe?: () => void }).installRouteProbe = installRouteProbe;\n' +
      (await readFile(entryPath, 'utf8')),
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
      await checkDisconnects(origin, server.output);
      await checkRenderTimeouts(origin);
      for (const engine of [chromium, firefox, webkit]) await checkBrowser(engine, origin);
      assert.doesNotMatch(
        server.output(),
        /AbortError|ERR_STREAM_PREMATURE_CLOSE|ECONNRESET|Internal Server Error/,
      );
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
