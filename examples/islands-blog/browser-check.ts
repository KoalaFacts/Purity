#!/usr/bin/env node
// Real-browser regression for the first operation on an interact island.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';

type FixtureKind = 'form' | 'external-submitter' | 'shadow-form' | 'aria-button' | 'svg-click';
const fixtureModule = '/src/interaction-fixture.ts';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Could not allocate a browser-check port'));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

async function fixtureCount(page: Page): Promise<number> {
  return page.evaluate(async (module) => {
    const { interactionFixtureCount } = await import(module);
    return interactionFixtureCount();
  }, fixtureModule);
}

async function releaseAndExpectOne(page: Page): Promise<void> {
  assert.equal(await fixtureCount(page), 0, 'the action must wait for hydration');
  await page.evaluate(async (module) => {
    const { releaseInteractionFixture } = await import(module);
    releaseInteractionFixture();
  }, fixtureModule);
  await page.waitForFunction(
    async (module) => (await import(module)).interactionFixtureCount() === 1,
    fixtureModule,
  );
  assert.equal(await fixtureCount(page), 1, 'the first action must run exactly once');
}

async function checkBrowser(name: string, browser: Browser, base: string): Promise<void> {
  const pages: Page[] = [];
  const errors: string[] = [];
  const open = async (kind?: FixtureKind): Promise<Page> => {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    pages.push(page);
    // The middleware server does not attach Vite's development WebSocket.
    // The HMR client is unrelated to island behavior and only emits noise.
    await page.route('**/@vite/client*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
    );
    if (kind) {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.evaluate(
        async ({ module, fixture }) => {
          const { setupInteractionFixture } = await import(module);
          setupInteractionFixture(fixture);
        },
        { module: fixtureModule, fixture: kind },
      );
    }
    return page;
  };
  try {
    for (const action of ['click', 'Enter', 'Space'] as const) {
      const page = await open();
      // Keep the chunk in flight until the user action has finished.
      await page.route('**/src/islands/expander.ts*', async (route) => {
        await delay(300);
        await route.continue();
      });
      await page.goto(base, { waitUntil: 'networkidle' });
      const button = page.locator('demo-expander button');
      if (action === 'click') await button.click();
      else {
        await button.focus();
        await page.keyboard.press(action);
      }
      await page.waitForFunction(() =>
        document
          .querySelector('demo-expander')
          ?.shadowRoot?.querySelector('button')
          ?.textContent?.includes('Hide'),
      );
      assert.equal((await button.textContent())?.trim(), '▾ Hide details');
      await button.click();
      await page.waitForFunction(() =>
        document
          .querySelector('demo-expander')
          ?.shadowRoot?.querySelector('button')
          ?.textContent?.includes('Show'),
      );
      assert.equal((await button.textContent())?.trim(), '▸ Show details');
      if (action === 'click') {
        await page.locator('purity-island[data-pi-trigger="load"] button').click();
        await page.waitForFunction(() =>
          document
            .querySelector('purity-island[data-pi-trigger="load"] strong')
            ?.textContent?.includes('1'),
        );
        const like = page.locator('purity-island[data-pi-trigger="visible"] button');
        await like.scrollIntoViewIfNeeded();
        await page.waitForLoadState('networkidle');
        await like.click();
        await page.waitForFunction(() =>
          document
            .querySelector('purity-island[data-pi-trigger="visible"] button')
            ?.textContent?.includes('Liked'),
        );
      }
    }

    const form = await open('form');
    await form.locator('purity-island form button').last().click();
    await releaseAndExpectOne(form);

    const externalSubmitter = await open('external-submitter');
    await externalSubmitter.locator('#external-submit').click();
    await releaseAndExpectOne(externalSubmitter);
    assert.equal(
      await externalSubmitter.evaluate(
        async (module) => (await import(module)).interactionFixtureSubmitter(),
        fixtureModule,
      ),
      'intent:save',
    );

    const shadowForm = await open('shadow-form');
    await shadowForm
      .locator('#shadow-host form')
      .evaluate((node: HTMLFormElement) => node.requestSubmit());
    await releaseAndExpectOne(shadowForm);

    for (const key of ['Enter', 'Space']) {
      const aria = await open('aria-button');
      await aria.locator('purity-island [role="button"]').last().focus();
      await aria.keyboard.press(key);
      await releaseAndExpectOne(aria);
    }

    const svg = await open('svg-click');
    await svg.locator('purity-island svg circle').last().click();
    await releaseAndExpectOne(svg);

    assert.deepEqual(errors, []);
    console.log(
      `${name} ${browser.version()}: first click, keyboard, forms, external submitter, and SVG passed`,
    );
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
}

const port = await freePort();
const base = `http://localhost:${port}/`;
const server = spawn(
  process.execPath,
  ['--conditions=development', '--experimental-strip-types', 'server.ts'],
  {
    cwd: import.meta.dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += String(chunk)));
server.stderr.on('data', (chunk) => (serverOutput += String(chunk)));
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(base);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The Vite server is still starting.
    }
    await delay(100);
  }
  assert.ok(ready, `islands demo server did not start:\n${serverOutput}`);
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch();
    try {
      await checkBrowser(name, browser, base);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
