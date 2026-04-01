# Benchmark Suite Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Purity benchmark suite to use only public APIs (`state`, `watch`, `each`, `html`), eliminate duplication, and produce both a js-framework-benchmark submission and an automated CI runner.

**Architecture:** Single shared `src/app.ts` exports `createApp(tbody)` with all benchmark operations. Two HTML entry points import it: `index.html` (leaderboard submission) and `bench.html` (interactive + headless runner). A Playwright orchestrator (`run-bench.mjs`) drives headless runs.

**Tech Stack:** Purity (`@purity/core`), Vite 8, Playwright (headless Chromium)

**Spec:** `docs/superpowers/specs/2026-04-01-benchmark-revamp-design.md`

---

### Task 1: Verify the signals.ts Watcher dedup fix

The fix is already on this branch. This task verifies it's correct and commits it standalone.

**Files:**
- Verify: `packages/core/src/signals.ts:81-106`
- Test: `packages/core/tests/` (existing 155 tests)

- [ ] **Step 1: Run the existing test suite**

Run: `npm test -w packages/core`
Expected: 12 test files, 155 tests passed

- [ ] **Step 2: Verify the dedup code is in place**

Read `packages/core/src/signals.ts` lines 81-106 and confirm the flush function contains:

```ts
const raw = watcher.getPending();
const seen = new Set<Signal.Computed<void>>();
for (let i = 0; i < raw.length; i++) {
  seen.add(raw[i]);
}

for (const s of seen) {
  watcher.watch(s);
  s.get();
}
```

- [ ] **Step 3: Commit the fix**

```bash
git add packages/core/src/signals.ts
git commit -m "fix: deduplicate Watcher.getPending() to prevent exponential producerNode growth"
```

---

### Task 2: Delete old benchmark files

Remove all superseded and debug artifacts. Keep only `index.html`, `vite.config.ts`, `package.json`, and `package-lock.json`.

**Files:**
- Delete: `benchmark/harness.html`
- Delete: `benchmark/auto-bench.html`
- Delete: `benchmark/standalone.html`
- Delete: `benchmark/bench/runner.ts`
- Delete: `benchmark/bench/` (directory)
- Delete: `benchmark/src/Main.ts`
- Delete: `benchmark/run-bench.mjs`

- [ ] **Step 1: Delete the files**

```bash
cd benchmark
rm -f harness.html auto-bench.html standalone.html run-bench.mjs
rm -rf bench/
rm -f src/Main.ts
```

- [ ] **Step 2: Verify only the keepers remain**

```bash
ls benchmark/
```

Expected: `dist/`, `index.html`, `node_modules/`, `package-lock.json`, `package.json`, `src/`, `vite.config.ts`

```bash
ls benchmark/src/
```

Expected: empty (Main.ts deleted)

- [ ] **Step 3: Commit the cleanup**

```bash
git add -A benchmark/
git commit -m "chore: remove old benchmark files and debug artifacts"
```

---

### Task 3: Create `src/runner.ts` — benchmark harness

The runner provides timing infrastructure: microtask flush, warmup, iterations, statistics. No globals — ES module exports only.

**Files:**
- Create: `benchmark/src/runner.ts`

- [ ] **Step 1: Create the runner module**

```ts
// benchmark/src/runner.ts
// Benchmark harness — warmup, iterations, stats, microtask flush.
// No globals. ES module exports consumed by bench.html.

const WARMUP = 3;
const ITERATIONS = 10;
const DISCARD_WORST = 2;

export interface Stats {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  n: number;
}

export interface BenchResult {
  name: string;
  stats: Stats;
  raw: number[];
}

export function calcStats(times: number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  const trimmed = sorted.slice(0, sorted.length - DISCARD_WORST);
  const n = trimmed.length;
  const mean = trimmed.reduce((a, b) => a + b, 0) / n;
  const median =
    n % 2 === 0
      ? (trimmed[n / 2 - 1] + trimmed[n / 2]) / 2
      : trimmed[Math.floor(n / 2)];
  const variance = trimmed.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, median, stddev: Math.sqrt(variance), min: trimmed[0], max: trimmed[n - 1], n };
}

export function formatStats(s: Stats): string {
  return `${s.median.toFixed(1)}ms (mean: ${s.mean.toFixed(1)}, σ: ${s.stddev.toFixed(1)}, min: ${s.min.toFixed(1)}, max: ${s.max.toFixed(1)}, n=${s.n})`;
}

// Purity effects are microtask-scheduled. Await a microtask to let
// watch() callbacks fire, then force synchronous layout.
function tick(): Promise<void> {
  return new Promise(r => queueMicrotask(r));
}

export async function flush(): Promise<void> {
  await tick();
  document.body.offsetHeight;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function benchmarkOp(
  name: string,
  setup: (() => void) | null,
  run: () => void,
  teardown: (() => void) | null,
): Promise<BenchResult> {
  const times: number[] = [];

  for (let i = 0; i < WARMUP; i++) {
    if (setup) setup();
    await flush();
    run();
    await flush();
    if (teardown) teardown();
    await flush();
    await sleep(50);
  }

  for (let i = 0; i < ITERATIONS; i++) {
    if (setup) setup();
    await flush();
    await sleep(10);

    const t0 = performance.now();
    run();
    await flush();
    times.push(performance.now() - t0);

    if (teardown) teardown();
    await flush();
    await sleep(50);
  }

  return { name, stats: calcStats(times), raw: times };
}
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/src/runner.ts
git commit -m "feat(benchmark): add runner harness with microtask flush and stats"
```

---

### Task 4: Create `src/app.ts` — shared benchmark app

The core module. Exports `createApp(tbody)` which sets up Purity rendering and returns operation handles. Uses `state`, `watch`, `each`, `html`.

**Files:**
- Create: `benchmark/src/app.ts`

- [ ] **Step 1: Create the app module**

```ts
// benchmark/src/app.ts
// Shared benchmark app using Purity public APIs: state, watch, each, html.

import { each, html, state, watch } from '../../packages/core/src/index.ts';

// Data generation — standard js-framework-benchmark pattern
const adjectives = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint','clean','elegant','easy','angry','crazy','helpful','mushy','odd','unsightly','adorable','important','inexpensive','cheap','expensive','fancy'];
const colours = ['red','yellow','blue','green','pink','brown','purple','brown','white','black','orange'];
const nouns = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger','pizza','mouse','keyboard'];

interface RowItem {
  id: number;
  label: string;
}

interface CachedRow {
  tr: HTMLTableRowElement;
  labelNode: Text;
  label: string;
}

export interface AppHandle {
  run(count: number): void;
  add(): void;
  update(): void;
  select(id: number): void;
  swapRows(): void;
  remove(id: number): void;
  clear(): void;
}

let nextId = 1;
const random = (max: number) => (Math.random() * max) | 0;
const buildLabel = () =>
  `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`;

function buildData(count: number): RowItem[] {
  const d = new Array<RowItem>(count);
  for (let i = 0; i < count; i++) d[i] = { id: nextId++, label: buildLabel() };
  return d;
}

export function createApp(tbody: HTMLElement): AppHandle {
  const data = state<RowItem[]>([]);
  const selectedId = state(0);

  // Row cache — for in-place label updates + selection highlighting
  const rows = new Map<number, CachedRow>();

  // Render via each() — keyed reconciliation with LIS built in
  const fragment = each(
    () => data(),
    (item: RowItem) => {
      const tr = html`
        <tr>
          <td class="col-md-1">${String(item.id)}</td>
          <td class="col-md-4"><a class="lbl">${item.label}</a></td>
          <td class="col-md-1"><a class="remove"><span class="remove glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
          <td class="col-md-6"></td>
        </tr>
      ` as unknown as HTMLTableRowElement;

      // Find the label text node for in-place updates
      const labelNode = tr.querySelector('.lbl')!.firstChild as Text;
      rows.set(item.id, { tr, labelNode, label: item.label });
      return tr;
    },
    (item: RowItem) => item.id,
  );
  tbody.appendChild(fragment);

  // In-place label updates — each()'s same-key path updates its internal
  // signal but html-created DOM doesn't react. Patch labels manually.
  watch(data, (list) => {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const row = rows.get(item.id);
      if (row && row.label !== item.label) {
        row.labelNode.data = item.label;
        row.label = item.label;
      }
    }
  });

  // Selection highlighting — external signal affecting per-row className
  watch(selectedId, (id, oldId) => {
    if (oldId) {
      const r = rows.get(oldId);
      if (r) r.tr.className = '';
    }
    if (id) {
      const r = rows.get(id);
      if (r) r.tr.className = 'danger';
    }
  });

  // Event delegation — single listener on tbody
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const tr = a.closest('tr')!;
    const id = +(tr.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) {
      handle.select(id);
    } else if (a.classList.contains('remove')) {
      handle.remove(id);
    }
  });

  const handle: AppHandle = {
    run(count: number) {
      data(buildData(count));
      selectedId(0);
    },
    add() {
      data(d => d.concat(buildData(1000)));
    },
    update() {
      data(d => {
        const c = d.slice();
        for (let i = 0; i < c.length; i += 10) {
          c[i] = { ...c[i], label: `${c[i].label} !!!` };
        }
        return c;
      });
    },
    select(id: number) {
      selectedId(id);
    },
    swapRows() {
      data(d => {
        if (d.length > 998) {
          const c = d.slice();
          const tmp = c[1];
          c[1] = c[998];
          c[998] = tmp;
          return c;
        }
        return d;
      });
    },
    remove(id: number) {
      rows.delete(id);
      data(d => d.filter(item => item.id !== id));
    },
    clear() {
      rows.clear();
      data([]);
      selectedId(0);
    },
  };

  return handle;
}
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/src/app.ts
git commit -m "feat(benchmark): add createApp with state, each, html, watch"
```

---

### Task 5: Rewrite `index.html` — js-framework-benchmark submission

Wire the existing HTML (Bootstrap layout, standard button IDs) to import `createApp`.

**Files:**
- Modify: `benchmark/index.html`

- [ ] **Step 1: Replace the script tag**

The existing `index.html` has `<script type="module" src="src/Main.ts"></script>` at line 47. Replace the entire file with the same HTML structure but importing from `src/app.ts`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Purity — js-framework-benchmark</title>
  <link href="/css/currentStyle.css" rel="stylesheet" />
</head>
<body>
  <div id="main">
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Purity (keyed)</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="run">Create 1,000 rows</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="runlots">Create 10,000 rows</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="add">Append 1,000 rows</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="update">Update every 10th row</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="clear">Clear</button>
              </div>
              <div class="col-sm-6 smallpad">
                <button type="button" class="btn btn-primary btn-block" id="swaprows">Swap Rows</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody id="tbody"></tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true"></span>
    </div>
  </div>
  <script type="module">
    import { createApp } from './src/app.ts';

    const app = createApp(document.getElementById('tbody'));

    document.getElementById('run').addEventListener('click', () => app.run(1000));
    document.getElementById('runlots').addEventListener('click', () => app.run(10000));
    document.getElementById('add').addEventListener('click', () => app.add());
    document.getElementById('update').addEventListener('click', () => app.update());
    document.getElementById('clear').addEventListener('click', () => app.clear());
    document.getElementById('swaprows').addEventListener('click', () => app.swapRows());
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/index.html
git commit -m "feat(benchmark): wire index.html to shared createApp"
```

---

### Task 6: Create `bench.html` — interactive + headless runner

Single file that works both as an interactive UI (click to run) and as a headless target (Playwright via `?auto`).

**Files:**
- Create: `benchmark/bench.html`

- [ ] **Step 1: Create bench.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Purity Benchmark Suite</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;padding:1.5rem;background:#f5f5f5;max-width:1200px;margin:0 auto}
    h1{color:#6c5ce7;margin-bottom:.25rem}
    .sub{color:#888;margin-bottom:1.5rem;font-size:.85rem}
    button{padding:.6rem 1.2rem;border:none;border-radius:6px;background:#6c5ce7;color:white;cursor:pointer;font-size:1rem;margin-bottom:1rem}
    button:hover{background:#5a4bd1}
    button:disabled{background:#ccc;cursor:not-allowed}
    #status{background:white;border-radius:8px;padding:1rem;margin-bottom:1rem;font-family:monospace;font-size:.85rem;white-space:pre-wrap;line-height:1.5;min-height:100px}
    table.results{width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;margin-bottom:1rem}
    table.results th{background:#6c5ce7;color:white;padding:.6rem;text-align:left;font-size:.85rem}
    table.results td{padding:.5rem .6rem;border-bottom:1px solid #eee;font-size:.85rem;font-family:monospace}
    table.results tr:hover td{background:#f8f8ff}
    .good{color:#27ae60;font-weight:bold}
    .ok{color:#f39c12}
    .slow{color:#e74c3c}
    #app{display:block;position:absolute;left:-9999px}
  </style>
</head>
<body>
  <h1>Purity Benchmark Suite</h1>
  <p class="sub">Warmup + multiple iterations + statistical analysis. Uses Purity public APIs: state, watch, each, html.</p>

  <div style="background:white;border-radius:8px;padding:1rem;margin-bottom:1rem;font-size:.85rem">
    <label>Warmup: <strong>3</strong></label>
    <label style="margin-left:1rem">Iterations: <strong>10</strong></label>
    <label style="margin-left:1rem">Discard worst: <strong>2</strong></label>
  </div>

  <button type="button" id="run-btn">Run Full Benchmark Suite</button>

  <div id="status">Ready. Click the button or add ?auto to the URL.</div>

  <table class="results" id="results-table" style="display:none">
    <thead>
      <tr>
        <th>Operation</th>
        <th>Median</th>
        <th>Mean</th>
        <th>StdDev</th>
        <th>Min</th>
        <th>Max</th>
      </tr>
    </thead>
    <tbody id="results-body"></tbody>
  </table>

  <div id="app">
    <table><tbody id="tbody"></tbody></table>
  </div>

  <script type="module">
    import { createApp } from './src/app.ts';
    import { benchmarkOp, flush, formatStats, sleep } from './src/runner.ts';

    const app = createApp(document.getElementById('tbody'));

    const statusEl = document.getElementById('status');
    const resultsTable = document.getElementById('results-table');
    const resultsBody = document.getElementById('results-body');
    const runBtn = document.getElementById('run-btn');

    function log(msg) {
      statusEl.textContent += msg + '\n';
      statusEl.scrollTop = statusEl.scrollHeight;
    }

    function addResult(name, s) {
      const tr = document.createElement('tr');
      const rating = s.median < 50 ? 'good' : s.median < 200 ? 'ok' : 'slow';
      const td1 = document.createElement('td'); td1.textContent = name;
      const td2 = document.createElement('td'); td2.textContent = s.median.toFixed(1) + 'ms'; td2.className = rating;
      const td3 = document.createElement('td'); td3.textContent = s.mean.toFixed(1) + 'ms';
      const td4 = document.createElement('td'); td4.textContent = s.stddev.toFixed(1) + 'ms';
      const td5 = document.createElement('td'); td5.textContent = s.min.toFixed(1) + 'ms';
      const td6 = document.createElement('td'); td6.textContent = s.max.toFixed(1) + 'ms';
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      tr.appendChild(td4); tr.appendChild(td5); tr.appendChild(td6);
      resultsBody.appendChild(tr);
    }

    // Setup/teardown helpers
    const clear = () => app.clear();
    const create1k = () => app.run(1000);
    const setup1k = () => { app.clear(); app.run(1000); };

    const suite = [
      ['Create 1,000 rows',      clear,   () => app.run(1000),   null ],
      ['Replace 1,000 rows',     setup1k, () => app.run(1000),   null ],
      ['Update every 10th row',  setup1k, () => app.update(),    clear],
      ['Select row',             setup1k, () => { const tr = document.getElementById('tbody').children[500]; app.select(+tr.firstChild.textContent); }, clear],
      ['Swap rows',              setup1k, () => app.swapRows(),   clear],
      ['Remove row',             setup1k, () => { const tr = document.getElementById('tbody').firstChild; app.remove(+tr.firstChild.textContent); }, clear],
      ['Clear 1,000 rows',       setup1k, () => app.clear(),      null ],
      ['Create 10,000 rows',     clear,   () => app.run(10000),  null ],
      ['Clear 10,000 rows',      null,    () => app.clear(),      null ],
      ['Append 1,000 rows',      setup1k, () => app.add(),        clear],
    ];

    async function runFullSuite() {
      runBtn.disabled = true;
      statusEl.textContent = '';
      while (resultsBody.firstChild) resultsBody.removeChild(resultsBody.firstChild);
      resultsTable.style.display = 'table';

      log('Purity Benchmark Suite');
      log('Warmup: 3 | Iterations: 10 | Discard worst: 2');
      log('');

      const results = [];

      for (const [name, setup, run, teardown] of suite) {
        log('Running: ' + name + '...');
        try {
          const result = await benchmarkOp(name, setup, run, teardown);
          log('  -> ' + formatStats(result.stats));
          addResult(name, result.stats);
          results.push({ name, ...result.stats });
        } catch (e) {
          log('  FAILED: ' + e.message);
          results.push({ name, error: e.message });
        }
        await sleep(100);
      }

      log('');
      log('Done! All operations used Purity public APIs.');
      log('BENCHMARK_COMPLETE');

      window.__benchResults = results;
      runBtn.disabled = false;
    }

    runBtn.addEventListener('click', runFullSuite);
    if (location.search.includes('auto')) runFullSuite();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/bench.html
git commit -m "feat(benchmark): add bench.html with interactive + headless modes"
```

---

### Task 7: Update `vite.config.ts` — two-entry build

Point Vite at the two HTML entry points.

**Files:**
- Modify: `benchmark/vite.config.ts`

- [ ] **Step 1: Rewrite vite.config.ts**

```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench.html'),
      },
    },
  },
});
```

- [ ] **Step 2: Build to verify both entries compile**

Run: `cd benchmark && npx vite build`
Expected: Output lists both `index.html` and `bench.html` in `dist/`, plus JS chunks, no errors.

- [ ] **Step 3: Commit**

```bash
git add benchmark/vite.config.ts
git commit -m "chore(benchmark): configure two-entry Vite build"
```

---

### Task 8: Create `run-bench.mjs` — Playwright orchestrator

Launches headless Chromium against the production build, runs the full suite, prints results.

**Files:**
- Create: `benchmark/run-bench.mjs`

- [ ] **Step 1: Create the orchestrator**

```js
// benchmark/run-bench.mjs
// Playwright orchestrator — runs bench.html?auto in headless Chromium.
// Designed to run against `vite preview` (production build, no HMR).

import { chromium } from 'playwright';

const PORT = process.env.PORT || 4173; // vite preview default

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage'],
});
const page = await browser.newPage();

page.on('pageerror', err => process.stderr.write(`[PAGE ERROR] ${err.message}\n`));
page.on('crash', () => {
  process.stderr.write('[CRASH] Page crashed!\n');
  process.exit(1);
});

await page.goto(`http://localhost:${PORT}/bench.html?auto`, {
  timeout: 15000,
  waitUntil: 'load',
});

// Wait for BENCHMARK_COMPLETE marker (up to 5 minutes)
await page.getByText('BENCHMARK_COMPLETE').waitFor({ timeout: 300000 });

const results = await page.evaluate(() => window.__benchResults);

// Print formatted table
const pad = (s, w) => String(s).padEnd(w);
console.log('Purity Browser Benchmark (Chromium headless, production build)');
console.log('Warmup: 3 | Iterations: 10 | Discard worst: 2\n');
console.log(`${pad('Operation', 28)} ${pad('Median', 10)} ${pad('Mean', 10)} ${pad('σ', 10)} ${pad('Min', 10)} ${pad('Max', 10)}`);
console.log('-'.repeat(78));

for (const r of results) {
  if (r.error || r.median == null) {
    console.log(`${pad(r.name, 28)} FAILED: ${r.error || 'unknown'}`);
  } else {
    console.log(`${pad(r.name, 28)} ${pad(`${r.median.toFixed(1)}ms`, 10)} ${pad(`${r.mean.toFixed(1)}ms`, 10)} ${pad(`${r.stddev.toFixed(1)}ms`, 10)} ${pad(`${r.min.toFixed(1)}ms`, 10)} ${pad(`${r.max.toFixed(1)}ms`, 10)}`);
  }
}

await browser.close();
```

- [ ] **Step 2: Commit**

```bash
git add benchmark/run-bench.mjs
git commit -m "feat(benchmark): add Playwright orchestrator for headless runs"
```

---

### Task 9: End-to-end verification

Build the production bundle, serve it, and run the full benchmark via Playwright to verify everything works together.

**Files:** (none created — verification only)

- [ ] **Step 1: Build**

Run: `cd benchmark && npx vite build`
Expected: Clean build with `index.html`, `bench.html`, and JS chunks in `dist/`.

- [ ] **Step 2: Start preview server**

Run (in background): `cd benchmark && npx vite preview --port 4173`
Wait 2 seconds for it to start.

- [ ] **Step 3: Verify index.html loads**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/`
Expected: `200`

- [ ] **Step 4: Run the orchestrator**

Run: `cd benchmark && node run-bench.mjs`
Expected: All 10 operations print results with no FAILED entries. Typical medians:
- Create 1k: 20-35ms
- Replace 1k: 20-35ms
- Update 10th: 4-10ms
- Select row: <1ms
- Swap rows: 2-5ms
- Remove row: 2-5ms
- Clear 1k: 2-5ms
- Create 10k: 200-350ms
- Clear 10k: <1ms
- Append 1k: 20-35ms

- [ ] **Step 5: Kill the preview server**

- [ ] **Step 6: Run core tests to ensure nothing regressed**

Run: `npm test -w packages/core`
Expected: 155 tests passed

- [ ] **Step 7: Commit any fixes if needed, then final commit**

```bash
git add -A benchmark/
git commit -m "test(benchmark): verify end-to-end benchmark suite"
```
