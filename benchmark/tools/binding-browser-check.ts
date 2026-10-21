import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { preview } from 'vite';

// Check both production fixtures before using their timings as a comparison.
const server = await preview({
  configFile: false,
  root: resolve(import.meta.dirname, '..'),
  base: '/Purity/',
  preview: { host: '127.0.0.1', port: 0, open: false },
});
try {
  const base = server.resolvedUrls!.local[0];
  for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await launcher.launch();
    try {
      for (const framework of ['purity', 'solid']) {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${base}apps/${framework}/binding.html`);
        await page.locator('#create-100').click();
        const inputs = page.locator('#container input');
        await inputs.last().waitFor();
        assert.equal(await inputs.count(), 100);
        for (const phase of ['created', 'updated', 'cleared']) {
          if (phase === 'updated') {
            await page.locator('#update-all').click();
            assert.deepEqual(
              await inputs.evaluateAll((nodes) => nodes.map((node) => node.value)),
              Array.from({ length: 100 }, (_, index) => `updated-${index + 1}`),
              `${engine}/${framework}: update all fields`,
            );
          }
          await inputs.first().fill(`typed-${phase}`);
          await inputs.last().fill(`last-${phase}`);
          await page.locator('#clear-all').click();
          await page.evaluate(
            () =>
              new Promise<void>((done) =>
                requestAnimationFrame(() => requestAnimationFrame(() => done())),
              ),
          );
          assert.deepEqual(
            await inputs.evaluateAll((nodes) => nodes.map((node) => node.value)),
            Array(100).fill(''),
            `${engine}/${framework}: clear after user input (${phase})`,
          );
        }
        assert.deepEqual(errors, []);
        console.log(
          JSON.stringify({ engine, framework, fields: 100, clearAfterUserInput: 'passed' }),
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
