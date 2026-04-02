#!/usr/bin/env node
// Playwright orchestrator — runs bench.html?auto in headless Chromium
// Usage: npx vite build && npx vite preview & node run-bench.ts

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

    if (!results?.length) {
      console.error('No results found.');
      process.exit(1);
    }

    // Print markdown table
    const fmt = (s) => `${s.median.toFixed(1)}ms`;
    console.log('| Operation | Purity | Solid | Svelte | Winner |');
    console.log('|-----------|--------|-------|--------|--------|');
    for (const r of results) {
      const vals = [
        { name: 'Purity', ms: r.purity.median },
        { name: 'Solid', ms: r.solid.median },
        { name: 'Svelte', ms: r.svelte.median },
      ];
      const winner = vals.reduce((a, b) => (a.ms < b.ms ? a : b)).name;
      console.log(
        `| ${r.name} | ${fmt(r.purity)} | ${fmt(r.solid)} | ${fmt(r.svelte)} | **${winner}** |`,
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
