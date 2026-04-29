// Run a scenario across all 4 frameworks and emit a side-by-side comparison
// across CPU buckets, memory delta, DOM ops, and key counters.
//
// Usage: node tools/compare.ts <scenario>
//
// Runs profile.ts sequentially for purity, solid, svelte, vue, then prints a
// Markdown table.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS = ['purity', 'solid', 'svelte', 'vue'] as const;
type Framework = (typeof FRAMEWORKS)[number];

const scenario = process.argv[2];
if (!scenario) {
  console.error('Usage: node tools/compare.ts <scenario>');
  process.exit(1);
}

const PROFILES_ROOT = '/tmp/profiles';

interface CpuProfileSlim {
  nodes: { id: number; callFrame: { functionName: string } }[];
  samples: number[];
  timeDeltas: number[];
}
interface Metrics {
  captureWallMs: number;
  trCount: number;
  network: { bytesIn: number; requestCount: number };
  metricsDelta: {
    jsHeapUsedSize: number;
    jsHeapTotalSize: number;
    domNodes: number;
    domListeners: number;
    layoutCount: number;
    recalcStyleCount: number;
    layoutDuration: number;
    recalcStyleDuration: number;
    scriptDuration: number;
    taskDuration: number;
  };
}
interface Result {
  wall: number;
  samples: number;
  jsUser: number;
  domOps: number;
  gc: number;
  program: number;
  idle: number;
  heapUsedMB: number;
  heapTotalMB: number;
  domNodes: number;
  listeners: number;
  layoutCount: number;
  layoutMs: number;
  styleMs: number;
  scriptMs: number;
  networkKB: number;
}

const NATIVE = new Set([
  'cloneNode',
  'appendChild',
  'replaceWith',
  'insertBefore',
  'removeChild',
  'createTextNode',
  'createElement',
  'setAttribute',
  'getAttribute',
  'querySelector',
  'addEventListener',
  'removeEventListener',
]);

const results: Partial<Record<Framework, Result>> = {};
for (const fw of FRAMEWORKS) {
  process.stdout.write(`profiling ${fw}/${scenario}... `);
  const r = spawnSync('node', [join(__dirname, 'profile.ts'), fw, scenario], {
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    console.error('\n' + (r.stderr || r.stdout));
    continue;
  }
  // Find the most recent dir for this fw+scenario.
  const dirs = readdirSync(PROFILES_ROOT)
    .filter((d) => d.startsWith(`${fw}-${scenario}-`))
    .sort();
  const latest = join(PROFILES_ROOT, dirs[dirs.length - 1]);
  const meta: Metrics = JSON.parse(readFileSync(join(latest, 'metrics.json'), 'utf-8'));
  const profile: CpuProfileSlim = JSON.parse(readFileSync(join(latest, 'cpu.cpuprofile'), 'utf-8'));

  const selfUs = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    selfUs.set(id, (selfUs.get(id) || 0) + (profile.timeDeltas[i] || 0));
  }
  let jsUser = 0,
    domOps = 0,
    gc = 0,
    prog = 0,
    idle = 0;
  for (const n of profile.nodes) {
    const s = selfUs.get(n.id) || 0;
    const name = n.callFrame.functionName || '(anon)';
    if (name === '(program)') prog += s;
    else if (name === '(garbage collector)') gc += s;
    else if (name === '(idle)') idle += s;
    else if (NATIVE.has(name)) domOps += s;
    else jsUser += s;
  }

  results[fw] = {
    wall: meta.captureWallMs,
    samples: profile.samples.length,
    jsUser: jsUser / 1000,
    domOps: domOps / 1000,
    gc: gc / 1000,
    program: prog / 1000,
    idle: idle / 1000,
    heapUsedMB: meta.metricsDelta.jsHeapUsedSize / 1e6,
    heapTotalMB: meta.metricsDelta.jsHeapTotalSize / 1e6,
    domNodes: meta.metricsDelta.domNodes,
    listeners: meta.metricsDelta.domListeners,
    layoutCount: meta.metricsDelta.layoutCount,
    layoutMs: meta.metricsDelta.layoutDuration * 1000,
    styleMs: meta.metricsDelta.recalcStyleDuration * 1000,
    scriptMs: meta.metricsDelta.scriptDuration * 1000,
    networkKB: meta.network.bytesIn / 1024,
  };
  console.log(`done (wall=${meta.captureWallMs}ms)`);
}

// ---- print Markdown table ----------------------------------------------
console.log('');
console.log(`# Comparison: ${scenario}`);
console.log('');

function row(label: string, key: keyof Result, fmt: (v: number) => string = (v) => v.toFixed(1)) {
  let s = `| ${label} `;
  for (const fw of FRAMEWORKS) {
    const v = results[fw]?.[key];
    s += `| ${v == null ? '—' : fmt(v as number)} `;
  }
  return s + '|';
}

console.log(`|  | purity | solid | svelte | vue |`);
console.log(`|---|---|---|---|---|`);
console.log(row('wall (ms)', 'wall', (v) => v.toFixed(0)));
console.log(row('jsUser self (ms)', 'jsUser'));
console.log(row('domOps native (ms)', 'domOps'));
console.log(row('gc (ms)', 'gc'));
console.log(row('(program) (ms)', 'program'));
console.log(row('script duration (ms)', 'scriptMs'));
console.log(row('layout (ms)', 'layoutMs'));
console.log(row('style recalc (ms)', 'styleMs'));
console.log(row('layout count', 'layoutCount', (v) => `${v}`));
console.log(row('heap used Δ (MB)', 'heapUsedMB', (v) => v.toFixed(2)));
console.log(row('heap total Δ (MB)', 'heapTotalMB', (v) => v.toFixed(2)));
console.log(row('DOM nodes Δ', 'domNodes', (v) => `${v}`));
console.log(row('listeners Δ', 'listeners', (v) => `${v}`));
console.log(row('network KB', 'networkKB'));
