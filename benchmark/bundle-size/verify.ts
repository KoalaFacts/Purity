import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { purity } from '../../packages/vite-plugin/dist/index.js';
import { chromium, firefox, webkit, type Page } from 'playwright';

async function renderControls(root: string, outputDir: string): Promise<string> {
  let serverTemplateSeen = false;
  const result = await build({
    root,
    configFile: false,
    logLevel: 'error',
    mode: 'production',
    resolve: { conditions: ['module', 'browser', 'production'] },
    plugins: [
      purity(),
      {
        name: 'purity-ssr-fixture-proof',
        enforce: 'post',
        transform(code, id) {
          if (resolve(id.split('?')[0]) !== join(import.meta.dirname, 'controls-view.ts')) return;
          serverTemplateSeen = true;
          assert(
            code.includes('__purity_h__') && !/html`/.test(code),
            'SSR fixture was not compiled',
          );
        },
      },
    ],
    build: {
      ssr: join(import.meta.dirname, 'controls-server.ts'),
      write: false,
      target: 'node24',
      minify: true,
      rollupOptions: { external: [/^@purityjs\//] },
    },
  });
  assert(!Array.isArray(result) && 'output' in result);
  assert(serverTemplateSeen, 'Missing SSR transform proof');
  assert.equal(result.output.length, 1);
  const chunk = result.output[0];
  assert.equal(chunk.type, 'chunk');
  assert.equal(chunk.dynamicImports.length, 0);
  assert(
    chunk.imports.every((name) => name.startsWith('@purityjs/')),
    'Unexpected SSR external',
  );
  assert(
    import.meta.resolve('@purityjs/ssr').includes('/packages/ssr/dist/'),
    'SSR source export used',
  );
  await mkdir(outputDir, { recursive: true });
  const directory = await mkdtemp(join(outputDir, 'ssr-'));
  const file = join(directory, 'view.mjs');
  try {
    await writeFile(file, chunk.code);
    const server = await import(pathToFileURL(file).href);
    const body = await server.render();
    assert.equal(typeof body, 'string');
    assert(
      body.includes('Alpha') && body.includes('<!--e-->') && body.includes('<!--er:'),
      'Missing SSR list markers',
    );
    return body;
  } finally {
    await unlink(file);
    await rmdir(directory);
  }
}

type Snapshot = typeof window & { bundleRows: Element[]; bundleDetails: Element | null };

async function verifyControls(page: Page, hydration: boolean): Promise<void> {
  if (hydration) {
    await page.locator('#app[data-hydrated="true"]').waitFor();
    assert(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-row]')).every(
          (row, i) => row === (window as Snapshot).bundleRows[i],
        ),
      ),
    );
  } else {
    await page.locator('[data-row]').first().waitFor();
    await captureNodes(page);
  }
  assert.deepEqual(await page.locator('[data-row]').allTextContents(), ['Alpha', 'Beta', 'Gamma']);
  await page.getByRole('button', { name: 'Reverse rows', exact: true }).click();
  assert.deepEqual(await page.locator('[data-row]').allTextContents(), ['Gamma', 'Beta', 'Alpha']);
  assert(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-row]')).every(
        (row, i) => row === (window as Snapshot).bundleRows[2 - i],
      ),
    ),
  );
  await page.getByRole('button', { name: 'Update first row', exact: true }).click();
  await page.getByText('Gamma!', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle details', exact: true }).click();
  await page.getByText('Details visible', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle details', exact: true }).click();
  await page.getByText('Details hidden', { exact: true }).waitFor();
  // A hidden match() case is disposed, so toggling back renders it fresh.
  assert(await page.evaluate(() => (window as Snapshot).bundleDetails?.isConnected === false));
}

async function captureNodes(page: Page): Promise<void> {
  await page.locator('[data-row]').first().waitFor();
  await page.evaluate(() => {
    (window as Snapshot).bundleRows = Array.from(document.querySelectorAll('[data-row]'));
    (window as Snapshot).bundleDetails =
      Array.from(document.querySelectorAll('p')).find((p) => p.textContent === 'Details hidden') ??
      null;
  });
}

export async function verifyProfiles(
  root: string,
  outputDir: string,
  profiles: string[],
  payloads: Map<string, string>,
) {
  const ssrHtml = await renderControls(root, outputDir);
  const serverErrors: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/action/greet' && request.method === 'POST') {
        const buffers: Buffer[] = [];
        for await (const part of request) buffers.push(Buffer.from(part));
        const req = new Request('http://localhost/action/greet', {
          method: 'POST',
          headers: { 'content-type': request.headers['content-type'] ?? '' },
          body: Buffer.concat(buffers),
        });
        const name = String((await req.formData()).get('name') ?? '').trim();
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify(
            name
              ? { message: `Hello, ${name}!` }
              : {
                  message: 'Please enter your name.',
                  fieldErrors: { name: 'Name is required.' },
                },
          ),
        );
      } else if (payloads.has(path)) {
        response.setHeader('content-type', 'text/javascript; charset=utf-8');
        response.end(payloads.get(path));
      } else if (profiles.some((profile) => path === `/${profile}/`)) {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        if (path.endsWith('-aot/'))
          response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'");
        response.end(
          `<!doctype html><html><body><main id="app">${path.startsWith('/hydration-') ? ssrHtml : ''}</main><script type="module" src="entry.js"></script></body></html>`,
        );
      } else if (path === '/favicon.ico') response.writeHead(204).end();
      else response.writeHead(404).end();
    })().catch((error) => {
      serverErrors.push(String(error));
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const engines: Record<string, string> = {};
  try {
    for (const [engine, browserType] of Object.entries({ chromium, firefox, webkit })) {
      const browser = await browserType.launch();
      try {
        for (const profile of profiles) {
          const page = await browser.newPage();
          let release = () => {};
          try {
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            page.on('console', (message) => {
              if (message.type() === 'error') errors.push(message.text());
            });
            const hydration = profile.startsWith('hydration-');
            if (hydration) {
              const gate = new Promise<void>((done) => {
                release = done;
              });
              await page.route('**/entry.js', async (route) => {
                await gate;
                await route.continue();
              });
            }
            const response = await page.goto(
              `http://127.0.0.1:${(server.address() as AddressInfo).port}/${profile}/`,
              { waitUntil: 'commit' },
            );
            assert.equal(response?.status(), 200);
            if (hydration) {
              await captureNodes(page);
              release();
            }
            if (profile.startsWith('counter-')) {
              for (let i = 0; i < 3; i++) {
                await page.getByRole('button', { name: `Count: ${i}`, exact: true }).click();
                await page.getByRole('button', { name: `Count: ${i + 1}`, exact: true }).waitFor();
              }
            } else if (profile.startsWith('form-')) {
              await page.getByRole('button', { name: 'Send greeting', exact: true }).click();
              await page.getByText('Name is required.', { exact: true }).waitFor();
              assert(
                await page
                  .getByLabel('Name', { exact: true })
                  .evaluate((input) => input === document.activeElement),
              );
              await page.getByLabel('Name', { exact: true }).fill('Ada');
              await page.getByText('Input: Ada', { exact: true }).waitFor();
              await page.getByRole('button', { name: 'Send greeting', exact: true }).click();
              await page.getByRole('status').filter({ hasText: 'Hello, Ada!' }).waitFor();
              assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Ada');
              assert(new URL(page.url()).pathname === `/${profile}/`, 'Form navigated away');
            } else await verifyControls(page, hydration);
            assert.deepEqual(errors, [], `${engine}/${profile} browser errors`);
          } finally {
            release();
            await page.close();
          }
        }
        engines[engine] = browser.version();
      } finally {
        await browser.close();
      }
    }
    assert.deepEqual(serverErrors, []);
    return {
      status: 'passed',
      engines,
      profiles,
      ssrHtmlSha256: createHash('sha256').update(ssrHtml).digest('hex'),
    };
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}
