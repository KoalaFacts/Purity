#!/usr/bin/env node
// Playwright orchestrator — runs bench.html?auto in headless Chromium
// Usage: npx vite build && npx vite preview & node run-bench.mjs

import { chromium } from 'playwright';

const PORT = process.env.PORT || 4173;
const URL = `http://localhost:${PORT}/bench.html?auto`;
const TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function main() {
  console.log(`\nPurity Benchmark Runner`);
  console.log(`Opening ${URL}...\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    // Wait for BENCHMARK_COMPLETE marker
    await page.waitForSelector('#bench-complete', { timeout: TIMEOUT });

    // Read results
    const results = await page.evaluate(() => window.__benchResults);

    if (!results || !results.length) {
      console.error('No results found.');
      process.exit(1);
    }

    // Print markdown table
    console.log('| Operation | Median | Mean | σ | Min | Max |');
    console.log('|-----------|--------|------|---|-----|-----|');
    for (const r of results) {
      const s = r.stats;
      console.log(
        `| ${r.name} | ${s.median.toFixed(1)}ms | ${s.mean.toFixed(1)}ms | ${s.stddev.toFixed(1)}ms | ${s.min.toFixed(1)}ms | ${s.max.toFixed(1)}ms |`,
      );
    }

    console.log('\n✓ Benchmark complete.');
  } catch (err) {
    console.error('Benchmark failed:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
