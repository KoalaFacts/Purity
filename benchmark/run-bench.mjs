import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage'],
});
const page = await browser.newPage();

page.on('pageerror', err => console.error(`[PAGE ERROR] ${err.message}`));
page.on('crash', () => console.error('[CRASH] Page crashed!'));

await page.goto('http://localhost:5180/harness.html', {
  timeout: 10000,
  waitUntil: 'load',
});

await page.waitForFunction(() => window.__ready, { timeout: 5000 });

console.log('Running all 10 operations in single page...\n');

const results = await page.evaluate(async () => {
  const ops = window.__ops;
  const clear = window.__clear;
  const create1k = window.__create1k;
  const bench = window.__bench;

  const suite = [
    ['Create 1,000 rows',      clear,                           () => ops.create1k(),   null  ],
    ['Replace 1,000 rows',     () => { clear(); create1k(); },  () => ops.create1k(),   null  ],
    ['Update every 10th row',  create1k,                        () => ops.update10th(), clear ],
    ['Select row',             create1k,                        () => ops.selectRow(),  clear ],
    ['Swap rows',              create1k,                        () => ops.swapRows(),   clear ],
    ['Remove row',             create1k,                        () => ops.removeRow(),  clear ],
    ['Clear 1,000 rows',       create1k,                        () => ops.clearAll(),   null  ],
    ['Create 10,000 rows',     clear,                           () => ops.create10k(),  null  ],
    ['Clear 10,000 rows',      null,                            () => ops.clearAll(),   null  ],
    ['Append 1,000 rows',      create1k,                        () => ops.append1k(),   clear ],
  ];

  const results = [];
  for (const [name, setup, run, teardown] of suite) {
    try {
      const s = await bench(setup, run, teardown);
      results.push({ name, ...s });
    } catch (e) {
      results.push({ name, error: e.message });
    }
  }
  return results;
}, { timeout: 300000 });

// Print results
const pad = (s, w) => String(s).padEnd(w);
console.log('Purity Browser Benchmark (Chromium headless, production build)');
console.log('Warmup: 2 | Iterations: 7 | Discard worst: 1\n');
console.log(`${pad('Operation', 28)} ${pad('Median', 10)} ${pad('Mean', 10)} ${pad('σ', 10)} ${pad('Min', 10)} ${pad('Max', 10)}`);
console.log('-'.repeat(78));

for (const r of results) {
  if (r.error || r.median == null) {
    console.log(`${pad(r.name, 28)} FAILED: ${r.error || 'unknown'}`);
  } else {
    console.log(`${pad(r.name, 28)} ${pad(`${r.median.toFixed(1)}ms`, 10)} ${pad(`${r.mean.toFixed(1)}ms`, 10)} ${pad(`${r.stddev.toFixed(1)}ms`, 10)} ${pad(`${r.min.toFixed(1)}ms`, 10)} ${pad(`${r.max.toFixed(1)}ms`, 10)}`);
  }
}

console.log('\nDone.');
await browser.close();
