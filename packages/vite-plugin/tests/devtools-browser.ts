// Check the shipped ESM/CJS plugin, real Vite base handling, and browser interactions.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { build, createServer, preview } from 'vite';
import { purity } from '../dist/index.js';

const require = createRequire(import.meta.url);
const cjsPurity: typeof purity = require('../dist/index.cjs').purity;
// Normalize Windows short/long temp path aliases for Vite's filesystem allow list.
const tempRoot = await realpath(tmpdir());
const dir = await realpath(await mkdtemp(join(tempRoot, 'purity-devtools-')));
const base = '/Purity/';
try {
  await writeFile(
    join(dir, 'index.html'),
    '<html><body><button id="increment">Increment</button><output></output><script type="module" src="/entry.ts"></script></body></html>',
  );
  await writeFile(
    join(dir, 'entry.ts'),
    `import { state, compute, watch } from '@purityjs/core';
const count = state(0);
const doubled = compute(() => count() * 2);
watch(() => { document.querySelector('output').textContent = String(doubled()); });
document.querySelector('#increment').addEventListener('click', () => count(count() + 1));`,
  );
  const config = {
    root: dir,
    configFile: false as const,
    base,
    logLevel: 'error' as const,
    resolve: {
      alias: { '@purityjs/core': resolve(import.meta.dirname, '../../core/dist/index.js') },
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      // The fixture is immutable; avoid native file watcher races on Windows.
      watch: null,
      fs: { allow: [dir, resolve(import.meta.dirname, '../../core/dist')] },
    },
  };
  for (const [format, plugin] of [
    ['ESM', purity],
    ['CJS', cjsPurity],
  ] as const) {
    const server = await createServer({ ...config, plugins: [plugin({ devtools: true })] });
    try {
      await server.listen();
      const url = server.resolvedUrls!.local[0];
      const response = await fetch(new URL(`${base}@id/__x00__virtual:purity-devtools`, url));
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Purity DevTools/);
      for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
        if (format === 'CJS' && name !== 'chromium') continue;
        const browser = await engine.launch();
        try {
          const page = await browser.newPage();
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
          });
          await page.goto(url);
          await page.getByRole('button', { name: 'Open Purity DevTools' }).click();
          const host = page.locator('#purity-devtools');
          await host.getByRole('searchbox').fill('state');
          await host
            .locator('.row')
            .filter({ hasText: /state.*· 0$/ })
            .waitFor();
          await page.locator('#increment').click();
          await page.locator('output').filter({ hasText: /^2$/ }).waitFor();
          await host.getByRole('button', { name: 'Refresh', exact: true }).click();
          await host
            .locator('.row')
            .filter({ hasText: /state.*· 1$/ })
            .waitFor();
          await host.getByRole('searchbox').fill('computed');
          await host
            .locator('.row')
            .filter({ hasText: /computed clean.*· 2$/ })
            .click();
          assert.match(await host.locator('.detail').innerText(), /Sources: #\d+/);
          await page.keyboard.press('Escape');
          assert.equal(await host.locator('.row').count(), 0);
          assert.equal(
            await host
              .getByRole('button', { name: 'Open Purity DevTools' })
              .evaluate((node) => node === (node.getRootNode() as ShadowRoot).activeElement),
            true,
          );
          await host.getByRole('button', { name: 'Open Purity DevTools' }).click();
          await host.getByRole('searchbox').fill('state');
          await page.keyboard.press('Escape');
          assert.equal(await host.locator('.row').count(), 0);
          await host.getByRole('button', { name: 'Open Purity DevTools' }).click();
          await host.getByRole('searchbox').fill('');

          if (name === 'chromium') {
            // A snapshot value must be collectible even while its rendered row remains visible.
            await page.evaluate(() => {
              const target = globalThis as any;
              const value = { payload: new Array(100_000).fill('devtools-retention') };
              target.__devtoolsProbe = new WeakRef(value);
              target.__savedInspector = target.__purity_inspect__;
              target.__purity_inspect__ = {
                version: 1,
                nodes: () => [{ kind: 'state', value, version: 0, sources: [], observers: [] }],
              };
            });
            await host.getByRole('button', { name: 'Refresh', exact: true }).click();
            await host.locator('.row').focus();
            await page.evaluate(() => {
              const target = globalThis as any;
              target.__purity_inspect__ = target.__savedInspector;
              delete target.__savedInspector;
            });
            const cdp = await page.context().newCDPSession(page);
            try {
              await cdp.send('HeapProfiler.collectGarbage');
              assert.equal(
                await page.evaluate(
                  () => (globalThis as any).__devtoolsProbe.deref() === undefined,
                ),
                true,
                'panel retained a snapshot payload',
              );
            } finally {
              await cdp.detach();
            }
          }
          await host.getByRole('button', { name: 'Close', exact: true }).click();
          assert.equal(await host.locator('.row').count(), 0);
          assert.deepEqual(errors, []);
          console.log(
            `${format} ${name} ${browser.version()}: base, filter, connections, updates, close/focus${name === 'chromium' ? ', snapshot GC' : ''} passed`,
          );
        } finally {
          await browser.close();
        }
      }
    } finally {
      await server.close();
    }
  }
  await build({ ...config, plugins: [purity({ devtools: true })], build: { outDir: 'dist' } });
  assert.doesNotMatch(await readFile(join(dir, 'dist/index.html'), 'utf8'), /purity-devtools/);
  const production = await preview({
    ...config,
    plugins: [purity({ devtools: true })],
    preview: { host: '127.0.0.1', port: 0 },
  });
  try {
    const url = production.resolvedUrls!.local[0];
    assert.doesNotMatch(await (await fetch(url)).text(), /purity-devtools/);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await page.locator('#increment').click();
      await page.locator('output').filter({ hasText: /^2$/ }).waitFor();
      assert.equal(await page.locator('#purity-devtools').count(), 0);
    } finally {
      await browser.close();
    }
    console.log('Production build and preview: app works without panel injection');
  } finally {
    await production.close();
  }
} finally {
  assert.equal(dirname(dir), tempRoot, 'cleanup must stay inside the temporary directory');
  await rm(dir, { recursive: true, force: true });
}
