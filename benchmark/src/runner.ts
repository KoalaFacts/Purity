// Benchmark harness — warmup, iterations, stats, microtask flush.

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
    n % 2 === 0 ? (trimmed[n / 2 - 1] + trimmed[n / 2]) / 2 : trimmed[Math.floor(n / 2)];
  const variance = trimmed.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, median, stddev: Math.sqrt(variance), min: trimmed[0], max: trimmed[n - 1], n };
}

export function formatStats(s: Stats): string {
  return `${s.median.toFixed(1)}ms (mean: ${s.mean.toFixed(1)}, σ: ${s.stddev.toFixed(1)}, min: ${s.min.toFixed(1)}, max: ${s.max.toFixed(1)}, n=${s.n})`;
}

function tick(): Promise<void> {
  return new Promise((r) => queueMicrotask(r));
}

export async function flush(): Promise<void> {
  await tick();
  document.body.offsetHeight;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    await sleep(30);
  }

  for (let i = 0; i < ITERATIONS; i++) {
    if (setup) setup();
    await flush();
    await sleep(5);

    const t0 = performance.now();
    run();
    await flush();
    times.push(performance.now() - t0);

    if (teardown) teardown();
    await flush();
    await sleep(30);
  }

  return { name, stats: calcStats(times), raw: times };
}
