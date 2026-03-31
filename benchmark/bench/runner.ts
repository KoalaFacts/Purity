/**
 * @module runner
 *
 * Purity Benchmark Runner — BenchmarkDotNet-style harness for the browser.
 *
 * Measures framework operations (create, update, swap, etc.) with proper warmup,
 * multiple iterations, outlier trimming, and descriptive statistics.
 *
 * No external dependencies — runs entirely in the browser with `performance.now()`.
 *
 * @example
 * ```bash
 * cd benchmark && npx vite && open http://localhost:5173/bench.html
 * ```
 */

// ── Configuration ──────────────────────────────────────────────────────────

/** Number of warmup rounds before measured iterations begin. */
const WARMUP = 3;

/** Number of timed iterations per benchmark operation. */
const ITERATIONS = 10;

/** Number of worst (slowest) results to discard from each run. */
const DISCARD_WORST = 2;

// ── Statistics ─────────────────────────────────────────────────────────────

/** Descriptive statistics computed from a set of benchmark timings. */
interface Stats {
  /** Arithmetic mean of the trimmed timings (ms). */
  mean: number;
  /** Median of the trimmed timings (ms) — preferred over mean for skewed distributions. */
  median: number;
  /** Population standard deviation of the trimmed timings (ms). */
  stddev: number;
  /** Fastest timing in the trimmed set (ms). */
  min: number;
  /** Slowest timing in the trimmed set (ms). */
  max: number;
  /** Number of timings used after trimming. */
  n: number;
}

/**
 * Computes descriptive statistics from raw timings.
 *
 * Sorts ascending, discards the {@link DISCARD_WORST} slowest outliers,
 * then calculates mean, median, standard deviation, min, and max on the
 * remaining (trimmed) values.
 *
 * @param times - Raw `performance.now()` durations in milliseconds.
 * @returns Descriptive statistics for the trimmed timing set.
 */
function stats(times: number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  const trimmed = sorted.slice(0, sorted.length - DISCARD_WORST);
  const n = trimmed.length;
  const mean = trimmed.reduce((a, b) => a + b, 0) / n;
  const median =
    n % 2 === 0 ? (trimmed[n / 2 - 1] + trimmed[n / 2]) / 2 : trimmed[Math.floor(n / 2)];
  const variance = trimmed.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  const min = trimmed[0];
  const max = trimmed[n - 1];
  return { mean, median, stddev, min, max, n };
}

/**
 * Formats a {@link Stats} object into a human-readable one-liner.
 *
 * @param s - The statistics to format.
 * @returns A string like `"12.3ms (mean: 13.1, σ: 1.2, min: 10.4, max: 16.0, n=8)"`.
 */
function formatStats(s: Stats): string {
  return `${s.median.toFixed(1)}ms (mean: ${s.mean.toFixed(1)}, σ: ${s.stddev.toFixed(1)}, min: ${s.min.toFixed(1)}, max: ${s.max.toFixed(1)}, n=${s.n})`;
}

// ── Microtask + Layout Flush ───────────────────────────────────────────────
//
// Purity effects are microtask-scheduled via `queueMicrotask` in the Watcher.
// To accurately measure DOM update cost we must:
//   1. Await a microtask so Purity's `watch()` callbacks fire
//   2. Read `offsetHeight` to force a synchronous layout/reflow
//
// Without this two-step flush the browser batches DOM work and the timing
// would only capture the signal write, not the resulting DOM mutations.

/**
 * Returns a promise that resolves on the next microtask.
 * This lets Purity's signal-driven `watch()` effects execute.
 */
function tick(): Promise<void> {
  return new Promise((r) => queueMicrotask(r));
}

/**
 * Flushes pending Purity effects and forces a synchronous browser layout.
 *
 * Call this after any state mutation to ensure DOM changes are fully applied
 * before taking a `performance.now()` measurement.
 */
async function flushAndLayout(): Promise<void> {
  await tick();
  document.body.offsetHeight; // force synchronous layout/reflow
}

// ── Benchmark Harness ──────────────────────────────────────────────────────

/** Result of a single benchmark operation across all iterations. */
interface BenchmarkResult {
  /** Human-readable name of the benchmarked operation. */
  name: string;
  /** Descriptive statistics computed from the measured iterations. */
  stats: Stats;
  /** Raw per-iteration timings in milliseconds (before trimming). */
  raw: number[];
}

/**
 * Benchmarks a single DOM operation with warmup, measurement, and teardown.
 *
 * **Execution flow per iteration:**
 * 1. `setup()` — prepare state (e.g. create 1k rows)
 * 2. `flush` — let Purity effects settle
 * 3. `sleep` — yield to browser for GC/paint (reduces variance)
 * 4. **`run()`** — the operation being measured (timed with `performance.now()`)
 * 5. `flush` — force DOM update + layout
 * 6. `teardown()` — clean up state
 *
 * The first {@link WARMUP} rounds are discarded (JIT warm-up, cache priming).
 * The next {@link ITERATIONS} rounds are timed and passed to {@link stats}.
 *
 * @param name     - Display name for this benchmark (e.g. `"Create 1,000 rows"`).
 * @param setup    - Optional function to prepare state before each iteration.
 * @param run      - The operation to measure.
 * @param teardown - Optional cleanup function called after each iteration.
 * @returns Statistics and raw timings for the measured iterations.
 */
async function benchmarkOp(
  name: string,
  setup: (() => void) | null,
  run: () => void,
  teardown: (() => void) | null,
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup — let the JIT compiler optimize hot paths
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
    await sleep(10); // yield to browser to reduce GC noise

    const start = performance.now();
    run();
    await flushAndLayout(); // microtask flush + layout
    const elapsed = performance.now() - start;

    times.push(elapsed);
    if (teardown) teardown();
    await flushAndLayout();
    await sleep(50);
  }

  const s = stats(times);
  return { name, stats: s, raw: times };
}

/**
 * Suspends execution for the given number of milliseconds.
 * Used between iterations to yield to the browser for GC and paint,
 * reducing measurement variance.
 *
 * @param ms - Duration to sleep in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Window Exports ─────────────────────────────────────────────────────────

declare global {
  interface Window {
    WARMUP: number;
    ITERATIONS: number;
    benchmarkOp: typeof benchmarkOp;
    formatStats: typeof formatStats;
    flushAndLayout: typeof flushAndLayout;
    sleep: typeof sleep;
  }
}

window.WARMUP = WARMUP;
window.ITERATIONS = ITERATIONS;
window.benchmarkOp = benchmarkOp;
window.formatStats = formatStats;
window.flushAndLayout = flushAndLayout;
window.sleep = sleep;
