// ---------------------------------------------------------------------------
// Purity Benchmark Runner — benchmark.net style
//
// Runs in the browser. Proper warmup + multiple iterations + statistics.
// No external dependencies — just open in Chrome.
//
// Usage: cd benchmark && npx vite && open http://localhost:5173/bench.html
// ---------------------------------------------------------------------------

const WARMUP = 3;
const ITERATIONS = 10;
const DISCARD_WORST = 2; // discard N worst results

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  // Discard worst N
  const trimmed = sorted.slice(0, sorted.length - DISCARD_WORST);
  const n = trimmed.length;
  const mean = trimmed.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0
    ? (trimmed[n / 2 - 1] + trimmed[n / 2]) / 2
    : trimmed[Math.floor(n / 2)];
  const variance = trimmed.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const min = trimmed[0];
  const max = trimmed[n - 1];
  return { mean, median, stddev, min, max, n };
}

function formatStats(s) {
  return `${s.median.toFixed(1)}ms (mean: ${s.mean.toFixed(1)}, σ: ${s.stddev.toFixed(1)}, min: ${s.min.toFixed(1)}, max: ${s.max.toFixed(1)}, n=${s.n})`;
}

// ---------------------------------------------------------------------------
// Microtask + layout flush
//
// Purity effects are microtask-scheduled (queueMicrotask in the Watcher).
// We must await a microtask to let watch() callbacks fire, THEN force a
// synchronous layout so the browser actually paints the DOM changes.
// ---------------------------------------------------------------------------

function tick() {
  return new Promise(r => queueMicrotask(r));
}

async function flushAndLayout() {
  await tick();            // let Purity watch() effects run
  document.body.offsetHeight; // force synchronous layout/reflow
}

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------

async function benchmarkOp(name, setup, run, teardown) {
  const times = [];

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    if (setup) setup();
    await flushAndLayout();
    run();
    await flushAndLayout();
    if (teardown) teardown();
    await flushAndLayout();
    await sleep(50);
  }

  // Measured iterations
  for (let i = 0; i < ITERATIONS; i++) {
    if (setup) setup();
    await flushAndLayout();
    await sleep(10);

    const start = performance.now();
    run();
    await flushAndLayout();   // includes microtask flush + layout
    const elapsed = performance.now() - start;

    times.push(elapsed);
    if (teardown) teardown();
    await flushAndLayout();
    await sleep(50);
  }

  const s = stats(times);
  return { name, stats: s, raw: times };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Export for use in bench.html
// ---------------------------------------------------------------------------

window.WARMUP = WARMUP;
window.ITERATIONS = ITERATIONS;
window.benchmarkOp = benchmarkOp;
window.formatStats = formatStats;
window.flushAndLayout = flushAndLayout;
window.sleep = sleep;
