#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { purity } from '@purityjs/vite-plugin';
import { chromium, type Page } from 'playwright';
import { build, preview } from 'vite';

type Scenario = 'keyed' | 'virtual';

interface Snapshot {
  heapBytes: number;
  domNodes: number;
  retainedHosts: number;
  retainedRows: number;
  retainedStates: number;
}

const benchmarkRoot = resolve(import.meta.dirname, '..');
const pagePath = resolve(benchmarkRoot, 'apps/purity/memory.html');
const cyclesPerBatch = 25;
const batches = 4;
const heapGrowthLimit = 1_500_000;
const domGrowthLimit = 100;
const retainedLimit = 2;

async function runBatch(
  page: Page,
  scenario: Scenario,
  cycles: number,
  retain = false,
): Promise<void> {
  await page.evaluate(
    async ({ name, count, keep }) => window.__purityMemoryProbe.runBatch(name, count, keep),
    {
      name: scenario,
      count: cycles,
      keep: retain,
    },
  );
  assert.equal(await page.locator('.row').count(), 0, `${scenario} left rows mounted`);
}

const viteConfig = {
  root: benchmarkRoot,
  configFile: false as const,
  base: '/Purity/',
  plugins: [purity()],
  resolve: {
    alias: [
      {
        find: /^@purityjs\/core$/,
        replacement: resolve(benchmarkRoot, '../packages/core/src/index.ts'),
      },
    ],
  },
  build: {
    outDir: 'dist/memory-check',
    rolldownOptions: { input: pagePath },
  },
};

await build(viteConfig);
const server = await preview({
  ...viteConfig,
  preview: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

try {
  browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
  const address = server.httpServer.address() as AddressInfo | null;
  assert.ok(address, 'Preview server did not start');
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/Purity/apps/purity/memory.html`);
  await page.waitForFunction(() => Boolean(window.__purityMemoryProbe));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');

  async function snapshot(): Promise<Snapshot> {
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const retained = await page.evaluate(() => window.__purityMemoryProbe.retained());
    return {
      heapBytes: heap.usedSize,
      domNodes: dom.nodes,
      retainedHosts: retained.hosts,
      retainedRows: retained.rows,
      retainedStates: retained.states,
    };
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, '### Purity memory retention\n\n');
  }
  for (const scenario of ['keyed', 'virtual'] as const) {
    await runBatch(page, scenario, 20);
    await page.evaluate(() => window.__purityMemoryProbe.reset());
    const baseline = await snapshot();
    const samples = [baseline];
    for (let i = 0; i < batches; i++) {
      await runBatch(page, scenario, cyclesPerBatch);
      samples.push(await snapshot());
    }

    const last = samples[samples.length - 1];
    const heapGrowth = last.heapBytes - samples[1].heapBytes;
    const domGrowth = last.domNodes - baseline.domNodes;
    const line = `${scenario}: heap ${samples.map((s) => (s.heapBytes / 1e6).toFixed(2)).join(' → ')} MB; DOM Δ${domGrowth}; retained hosts ${last.retainedHosts}/${batches * cyclesPerBatch}, rows ${last.retainedRows}/${batches * cyclesPerBatch}, states ${last.retainedStates}/${batches * cyclesPerBatch}`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
    }
    assert.ok(
      heapGrowth <= heapGrowthLimit,
      `${scenario} heap grew ${(heapGrowth / 1e6).toFixed(2)} MB after warmup`,
    );
    assert.ok(domGrowth <= domGrowthLimit, `${scenario} retained ${domGrowth} DOM nodes`);
    assert.ok(last.retainedHosts <= retainedLimit, `${scenario} retained detached hosts`);
    assert.ok(last.retainedRows <= retainedLimit, `${scenario} retained detached rows`);
    assert.ok(last.retainedStates <= retainedLimit, `${scenario} retained disposed states`);
    await page.evaluate(() => window.__purityMemoryProbe.reset());
  }

  await runBatch(page, 'keyed', 10, true);
  const positiveControl = await snapshot();
  assert.ok(positiveControl.retainedHosts >= 10, 'Failed to detect retained hosts');
  assert.ok(positiveControl.retainedRows >= 10, 'Failed to detect retained rows');
  assert.ok(positiveControl.retainedStates >= 10, 'Failed to detect retained states');
  console.log('Positive control: 10 intentionally retained mounts detected');
  await page.evaluate(() => window.__purityMemoryProbe.reset());
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      '- Positive control detected 10 retained mounts\n',
    );
  }
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) => {
    server.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
}
