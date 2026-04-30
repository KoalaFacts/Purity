// CPU + memory + I/O profiler. Captures one scenario for one framework.
//
// Usage:
//   node tools/profile.ts <framework> <scenario>
//     framework: purity | solid | svelte | vue
//     scenario:  create | replace | append | update | swap | clear-after-create
//
// Output: /tmp/profiles/<framework>-<scenario>-<timestamp>/
//   cpu.cpuprofile     — load into Chrome DevTools Performance tab to view
//   heap-before.heapsnapshot, heap-after.heapsnapshot
//   metrics.json       — DOM nodes, layout count, paint count, network bytes
//   timeline.json      — phase timings (warmup, capture, paint)
//
// Note: in-browser CDP profiling adds ~3x overhead vs raw bench. Use these
// numbers for RELATIVE comparison between frameworks, not absolute timings.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

type Framework = 'purity' | 'solid' | 'svelte' | 'vue';
type Scenario = {
  page: string;
  setup: { click: string; wait: 'paint' }[];
  capture: { click: string; wait: 'paint' }[];
};

const FRAMEWORKS = new Set<Framework>(['purity', 'solid', 'svelte', 'vue']);

// scenario → (page, setup steps, capture step). Each step is a CSS selector to
// click, with optional explicit waits. The capture step is the operation we
// time and profile; setup runs unmeasured to put the page in the right state.
const SCENARIOS: Record<string, Scenario> = {
  create: {
    page: 'index',
    setup: [], // page-load is the create
    capture: [{ click: '#runlots', wait: 'paint' }],
  },
  append: {
    page: 'index',
    setup: [{ click: '#runlots', wait: 'paint' }],
    capture: [{ click: '#add-10k', wait: 'paint' }],
  },
  replace: {
    page: 'index',
    setup: [{ click: '#runlots', wait: 'paint' }],
    capture: [{ click: '#runlots', wait: 'paint' }],
  },
  update: {
    page: 'index',
    setup: [{ click: '#runlots', wait: 'paint' }],
    capture: [{ click: '#update', wait: 'paint' }],
  },
  swap: {
    page: 'index',
    setup: [{ click: '#runlots', wait: 'paint' }],
    capture: [{ click: '#swaprows', wait: 'paint' }],
  },
  'clear-after-create': {
    page: 'index',
    setup: [{ click: '#runlots', wait: 'paint' }],
    capture: [{ click: '#clear', wait: 'paint' }],
  },
};

const fw = process.argv[2] as Framework;
const scenarioName = process.argv[3];
if (!FRAMEWORKS.has(fw) || !SCENARIOS[scenarioName]) {
  console.error(
    'Usage: node tools/profile.ts <purity|solid|svelte|vue> <create|append|replace|update|swap|clear-after-create>',
  );
  process.exit(1);
}
const scenario = SCENARIOS[scenarioName];

const PORT = process.env.PORT || 4173;
const BASE = `http://localhost:${PORT}/Purity`;
const url = `${BASE}/apps/${fw}/${scenario.page}.html`;

const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const outDir = `/tmp/profiles/${fw}-${scenarioName}-${ts}`;
mkdirSync(outDir, { recursive: true });

const timeline: Record<string, unknown> = {
  framework: fw,
  scenario: scenarioName,
  page: scenario.page,
  url,
  outDir,
};

const browser = await chromium.launch();
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);

// CDP domains we use
await cdp.send('Network.enable');
await cdp.send('Page.enable');
await cdp.send('Performance.enable');
await cdp.send('HeapProfiler.enable');
await cdp.send('Profiler.enable');

// Track network bytes across the whole run.
let bytesIn = 0;
let requestCount = 0;
cdp.on('Network.loadingFinished', (e: { encodedDataLength?: number }) => {
  bytesIn += e.encodedDataLength || 0;
});
cdp.on('Network.requestWillBeSent', () => {
  requestCount++;
});

// ---- load page ----------------------------------------------------------
const t0 = Date.now();
await page.goto(url, { waitUntil: 'networkidle' });
timeline.pageLoad = Date.now() - t0;

// Warm up: JIT settles after ONE full create+clear cycle.
async function clickAndPaint(selector: string): Promise<void> {
  await page.evaluate(async (s) => {
    (document.querySelector(s) as HTMLElement).click();
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }, selector);
}
await clickAndPaint('#runlots');
await clickAndPaint('#clear');
await page.waitForTimeout(200);

// Setup steps
for (const step of scenario.setup) {
  await clickAndPaint(step.click);
}
await page.waitForTimeout(100);

// ---- pre-capture memory snapshot ----------------------------------------
async function snapshot(file: string): Promise<number> {
  // Force GC twice to stabilize.
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks: string[] = [];
  const handler = (e: { chunk: string }) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', handler);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', handler);
  writeFileSync(join(outDir, file), chunks.join(''));
  return chunks.reduce((s, c) => s + c.length, 0);
}

timeline.heapBeforeBytes = await snapshot('heap-before.heapsnapshot');
const memBefore = await cdp.send('Performance.getMetrics');

// ---- capture: CPU profile + counters around the operation ---------------
await cdp.send('Profiler.setSamplingInterval', { interval: 50 }); // 50µs
await cdp.send('Profiler.start');

const captureStart = Date.now();
for (const step of scenario.capture) {
  await clickAndPaint(step.click);
}
timeline.captureWallMs = Date.now() - captureStart;

const { profile } = await cdp.send('Profiler.stop');
writeFileSync(join(outDir, 'cpu.cpuprofile'), JSON.stringify(profile));
timeline.cpuSamples = profile.samples.length;

// ---- post-capture metrics + memory --------------------------------------
const memAfter = await cdp.send('Performance.getMetrics');
timeline.heapAfterBytes = await snapshot('heap-after.heapsnapshot');

const trCount = await page.locator('tr').count();
timeline.trCount = trCount;
timeline.network = { bytesIn, requestCount };

// Extract the metrics we care about — Performance.getMetrics returns counters.
type MetricsResp = { metrics: { name: string; value: number }[] };
function asMap(metrics: MetricsResp): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of metrics.metrics) m[e.name] = e.value;
  return m;
}
const mBefore = asMap(memBefore);
const mAfter = asMap(memAfter);
const metricsDelta = {
  // bytes
  jsHeapUsedSize: mAfter.JSHeapUsedSize - mBefore.JSHeapUsedSize,
  jsHeapTotalSize: mAfter.JSHeapTotalSize - mBefore.JSHeapTotalSize,
  // counts
  domNodes: mAfter.Nodes - mBefore.Nodes,
  domListeners: mAfter.JSEventListeners - mBefore.JSEventListeners,
  layoutCount: mAfter.LayoutCount - mBefore.LayoutCount,
  recalcStyleCount: mAfter.RecalcStyleCount - mBefore.RecalcStyleCount,
  layoutDuration: mAfter.LayoutDuration - mBefore.LayoutDuration,
  recalcStyleDuration: mAfter.RecalcStyleDuration - mBefore.RecalcStyleDuration,
  scriptDuration: mAfter.ScriptDuration - mBefore.ScriptDuration,
  taskDuration: mAfter.TaskDuration - mBefore.TaskDuration,
};
timeline.metricsDelta = metricsDelta;

writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(timeline, null, 2));

console.log(
  `[${fw}/${scenarioName}] wall=${timeline.captureWallMs}ms tr=${trCount} samples=${profile.samples.length}`,
);
console.log(
  `  heap delta: ${(metricsDelta.jsHeapUsedSize / 1e6).toFixed(2)}MB used (+${(metricsDelta.jsHeapTotalSize / 1e6).toFixed(2)}MB total)`,
);
console.log(`  DOM: +${metricsDelta.domNodes} nodes, +${metricsDelta.domListeners} listeners`);
console.log(
  `  layout: ${metricsDelta.layoutCount} (${(metricsDelta.layoutDuration * 1000).toFixed(1)}ms), styles: ${metricsDelta.recalcStyleCount} (${(metricsDelta.recalcStyleDuration * 1000).toFixed(1)}ms)`,
);
console.log(
  `  script: ${(metricsDelta.scriptDuration * 1000).toFixed(1)}ms / task: ${(metricsDelta.taskDuration * 1000).toFixed(1)}ms`,
);
console.log(`  artifacts: ${outDir}`);

await browser.close();
