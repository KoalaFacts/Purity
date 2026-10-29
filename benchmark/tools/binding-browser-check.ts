import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { browserEngines } from './browser-engines.ts';
import { preview } from 'vite';

const isolated = process.env.SOLID_V2_FIXTURE === '1';
assert(!process.env.SOLID_V2_FIXTURE || isolated, 'Expected SOLID_V2_FIXTURE=1');
let solidServer: Awaited<ReturnType<typeof preview>> | undefined;

// Check both production fixtures before using their timings as a comparison.
const server = await preview({
  configFile: false,
  root: resolve(import.meta.dirname, '..'),
  base: '/Purity/',
  preview: { host: '127.0.0.1', port: 0, open: false },
});
try {
  if (isolated)
    solidServer = await preview({
      configFile: false,
      root: resolve(import.meta.dirname, '../solid-v2/app-fixture'),
      build: { outDir: 'dist-workloads' },
      preview: { host: '127.0.0.1', port: 0, open: false },
    });
  const base = server.resolvedUrls!.local[0];
  for (const [engine, launcher] of browserEngines) {
    const browser = await launcher.launch();
    try {
      for (const framework of ['purity', 'solid']) {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(
          framework === 'solid' && solidServer
            ? `${solidServer.resolvedUrls!.local[0]}binding.html`
            : `${base}apps/${framework}/binding.html`,
        );
        await page.locator('#create-100').click();
        const inputs = page.locator('#container input');
        await inputs.last().waitFor();
        assert.equal(await inputs.count(), 100);
        assert.deepEqual(
          await inputs.evaluateAll((nodes) =>
            nodes.map((node) => ({
              id: node.id,
              labels: Array.from(node.labels ?? [], (label) => label.textContent?.trim()),
            })),
          ),
          Array.from({ length: 100 }, (_, index) => ({
            id: `field-${index + 1}`,
            labels: [`Field ${index + 1}:`],
          })),
          `${engine}/${framework}: every input has its explicit label`,
        );
        await page.locator('label[for="field-1"]').click();
        assert.equal(
          await inputs.first().evaluate((node) => node === document.activeElement),
          true,
        );
        for (const phase of ['created', 'updated', 'cleared', 'recreated']) {
          if (phase === 'recreated') await page.locator('#create-100').click();
          if (phase === 'updated' || phase === 'recreated') {
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
  if (isolated) {
    const output = resolve(import.meta.dirname, '../dist/fixture-parity-rc18');
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, 'binding-provenance.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          sourceRef: execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: import.meta.dirname,
            encoding: 'utf8',
          }).trim(),
          complete: true,
          scope:
            'rc18 binding labels, focus, clear-after-user-input and recreation only; not timings',
          engines: browserEngines.map(([name]) => name),
        },
        null,
        2,
      ) + '\n',
    );
  }
} finally {
  if (solidServer)
    await new Promise<void>((done, reject) =>
      solidServer!.httpServer.close((error) => (error ? reject(error) : done())),
    );
  await new Promise<void>((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
