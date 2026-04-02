#!/usr/bin/env node
// Playwright orchestrator — runs each framework app in headless Chromium,
// performs operations via button clicks, measures rendering time via
// Chrome DevTools Protocol (Performance.metrics / tracing).
//
// Usage: cd benchmark && npm run build-prod && npx vite preview & node --import tsx run-bench.ts

import { type CDPSession, type Page, chromium } from 'playwright';

const PORT = process.env.PORT || 4173;
const BASE = `http://localhost:${PORT}`;
const WARMUP = 3;
const ITERATIONS = 5;
const FRAMEWORKS = ['purity', 'solid', 'svelte', 'vue'] as const;

interface Op {
  name: string;
  // Setup: buttons to click before the measured operation
  setup?: string[];
  // The button to click and measure
  btn: string;
}

const OPS: Op[] = [
  { name: 'Create 1,000 rows', setup: ['clear'], btn: 'run' },
  { name: 'Create 10,000 rows', setup: ['clear'], btn: 'runlots' },
  { name: 'Append 1,000 rows', setup: ['clear', 'run'], btn: 'add' },
  { name: 'Replace 1,000 rows', setup: ['clear', 'run'], btn: 'run' },
  { name: 'Update every 10th', setup: ['clear', 'run'], btn: 'update' },
  { name: 'Swap rows', setup: ['clear', 'run'], btn: 'swaprows' },
  { name: 'Clear 1,000 rows', setup: ['clear', 'run'], btn: 'clear' },
  { name: 'Clear 10,000 rows', setup: ['clear', 'runlots'], btn: 'clear' },
];

// ---------------------------------------------------------------------------
// Measure a single operation using requestAnimationFrame round-trip
// ---------------------------------------------------------------------------

async function measureOp(page: Page, btnId: string): Promise<number> {
  // Inject timing: click the button, then measure until browser paints
  const duration = await page.evaluate((id) => {
    return new Promise<number>((resolve) => {
      const btn = document.getElementById(id)!;
      const t0 = performance.now();
      btn.click();
      // Wait for the framework to process + browser to paint
      requestAnimationFrame(() => {
        // Second rAF to ensure the paint actually happened
        requestAnimationFrame(() => {
          resolve(performance.now() - t0);
        });
      });
    });
  }, btnId);
  return duration;
}

async function settle(page: Page): Promise<void> {
  // Wait for pending microtasks + paint
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

// ---------------------------------------------------------------------------
// Run one operation for one framework
// ---------------------------------------------------------------------------

async function benchOp(page: Page, op: Op): Promise<number[]> {
  const times: number[] = [];

  for (let i = 0; i < WARMUP + ITERATIONS; i++) {
    // Setup
    if (op.setup) {
      for (const btnId of op.setup) {
        await page.click(`#${btnId}`);
        await settle(page);
      }
    }
    await settle(page);

    // Measure
    const t = await measureOp(page, op.btn);

    if (i >= WARMUP) {
      times.push(t);
    }

    // Small delay between iterations
    await page.waitForTimeout(20);
  }

  return times;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\nPurity Benchmark Runner');
  console.log(`Frameworks: ${FRAMEWORKS.join(', ')}`);
  console.log(`Warmup: ${WARMUP} | Iterations: ${ITERATIONS}\n`);

  const browser = await chromium.launch({ headless: true });
  const results: Record<string, Record<string, number>> = {};

  for (const fw of FRAMEWORKS) {
    results[fw] = {};
    const url = `${BASE}/apps/${fw}/`;
    console.log(`--- ${fw} (${url}) ---`);

    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle' });

      for (const op of OPS) {
        const times = await benchOp(page, op);
        const med = median(times);
        results[fw][op.name] = med;
        console.log(`  ${op.name}: ${med.toFixed(1)}ms`);
      }
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  // Print markdown table
  console.log('\n## Results\n');
  const hdr = ['Operation', ...FRAMEWORKS.map((f) => f.charAt(0).toUpperCase() + f.slice(1)), 'Winner'];
  console.log(`| ${hdr.join(' | ')} |`);
  console.log(`|${hdr.map(() => '---').join('|')}|`);

  for (const op of OPS) {
    const vals = FRAMEWORKS.map((fw) => ({
      name: fw.charAt(0).toUpperCase() + fw.slice(1),
      ms: results[fw][op.name] ?? 999,
    }));
    const winner = vals.reduce((a, b) => (a.ms < b.ms ? a : b)).name;
    const cells = vals.map((v) => `${v.ms.toFixed(1)}ms`);
    console.log(`| ${op.name} | ${cells.join(' | ')} | **${winner}** |`);
  }

  // Export results as JSON for the dashboard
  const benchResults = OPS.map((op) => ({
    name: op.name,
    ...Object.fromEntries(FRAMEWORKS.map((fw) => [fw, { median: results[fw][op.name] ?? 0 }])),
  }));

  console.log('\n' + JSON.stringify(benchResults));
  console.log('\n✓ Benchmark complete.');

  await browser.close();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
