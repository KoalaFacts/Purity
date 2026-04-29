// Analyze a single profile artifact directory. Produces a top-N hot
// functions table and a metrics summary, both as plain text on stdout.
//
// Usage: node tools/analyze.ts /tmp/profiles/<dir> [topN]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceMapConsumer } from 'source-map-js';

const dir = process.argv[2];
const topN = +(process.argv[3] || 25);
if (!dir) {
  console.error('Usage: node tools/analyze.ts <profile-dir> [topN]');
  process.exit(1);
}

// Source-map demangler: given a profile callFrame's url + line/col, return
// the original symbol name. We resolve URLs like
// `http://localhost:4173/Purity/assets/foo-XYZ.js` against the bench's
// `dist/assets/` so we can read `foo-XYZ.js.map` from disk.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS = join(__dirname, '..', 'dist', 'assets');
const consumerCache = new Map<string, SourceMapConsumer | null>();
function getConsumer(url: string): SourceMapConsumer | null {
  if (consumerCache.has(url)) return consumerCache.get(url) ?? null;
  let consumer: SourceMapConsumer | null = null;
  // Pull the basename (e.g. `src-D8vC1-sD.js`) and look for `.map` next to it.
  const m = url.match(/\/assets\/([^/?#]+\.js)(?:[?#]|$)/);
  if (m) {
    const mapPath = join(DIST_ASSETS, `${m[1]}.map`);
    if (existsSync(mapPath)) {
      try {
        const raw = JSON.parse(readFileSync(mapPath, 'utf-8'));
        consumer = new SourceMapConsumer(raw);
      } catch {
        consumer = null;
      }
    }
  }
  consumerCache.set(url, consumer);
  return consumer;
}

function demangle(url: string, line: number, column: number, fallback: string): { name: string; source: string } {
  const consumer = getConsumer(url);
  if (!consumer) return { name: fallback, source: url };
  // Profiler line/col are zero-based; source-map expects line one-based.
  const orig = consumer.originalPositionFor({ line: line + 1, column });
  return {
    name: orig.name || fallback,
    source: orig.source || url,
  };
}

interface CallFrame {
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}
interface ProfileNode {
  id: number;
  callFrame: CallFrame;
  hitCount?: number;
  children?: number[];
}
interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}
interface Metrics {
  framework: string;
  scenario: string;
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

const meta: Metrics = JSON.parse(readFileSync(join(dir, 'metrics.json'), 'utf-8'));
const profile: CpuProfile = JSON.parse(readFileSync(join(dir, 'cpu.cpuprofile'), 'utf-8'));

// ---- CPU breakdown ------------------------------------------------------
const nodeById = new Map<number, ProfileNode>(profile.nodes.map((n) => [n.id, n]));
const selfUs = new Map<number, number>();
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i];
  const dUs = profile.timeDeltas[i] || 0;
  selfUs.set(id, (selfUs.get(id) || 0) + dUs);
}

// Total time = self + sum of children's totals (no double counting).
function totalOf(id: number, memo = new Map<number, number>()): number {
  const cached = memo.get(id);
  if (cached != null) return cached;
  const n = nodeById.get(id)!;
  let t = selfUs.get(id) || 0;
  for (const c of n.children || []) t += totalOf(c, memo);
  memo.set(id, t);
  return t;
}
const totalMemo = new Map<number, number>();
for (const id of nodeById.keys()) totalOf(id, totalMemo);

// Fold by callFrame so re-entries from different call sites combine.
interface FoldEntry {
  name: string;
  url: string;
  line: number;
  self: number;
  total: number;
}
const folded = new Map<string, FoldEntry>();
for (const n of profile.nodes) {
  const f = n.callFrame;
  const minified = f.functionName || '(anon)';
  const { name, source } =
    f.url && (f.lineNumber >= 0 || f.columnNumber >= 0)
      ? demangle(f.url, f.lineNumber, f.columnNumber, minified)
      : { name: minified, source: f.url || '' };
  const key = `${name}|${source}|${f.lineNumber}`;
  const e: FoldEntry = folded.get(key) || {
    name,
    url: source,
    line: f.lineNumber,
    self: 0,
    total: 0,
  };
  e.self += selfUs.get(n.id) || 0;
  e.total += totalMemo.get(n.id) || 0;
  folded.set(key, e);
}

// ---- bucket native engine time (V8 calls outside JS) -------------------
// V8 emits these synthetic frames for non-JS work. Useful aggregate.
const NATIVE_FRAMES = new Set([
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
const buckets: Record<string, number> = {
  '(program)': 0,
  '(garbage collector)': 0,
  '(idle)': 0,
  domOps: 0,
  jsUser: 0,
};
for (const e of folded.values()) {
  if (e.name === '(program)' || e.name === '(garbage collector)' || e.name === '(idle)') {
    buckets[e.name] += e.self;
  } else if (NATIVE_FRAMES.has(e.name)) {
    buckets.domOps += e.self;
  } else {
    buckets.jsUser += e.self;
  }
}

// ---- output -------------------------------------------------------------
const totalUs = profile.endTime - profile.startTime;
console.log(`# ${meta.framework} / ${meta.scenario}`);
console.log(`# wall: ${meta.captureWallMs}ms (sampled ${(totalUs / 1000).toFixed(0)}ms, ${profile.samples.length} samples)`);
console.log(`# tr: ${meta.trCount}`);
console.log('');

console.log(`## CPU breakdown (self ms)`);
console.log(`  jsUser            : ${(buckets.jsUser / 1000).toFixed(1)}`);
console.log(`  domOps (native)   : ${(buckets.domOps / 1000).toFixed(1)}`);
console.log(`  garbage collector : ${(buckets['(garbage collector)'] / 1000).toFixed(1)}`);
console.log(`  (program)         : ${(buckets['(program)'] / 1000).toFixed(1)}     (V8 internal: layout/paint/parse)`);
console.log(`  (idle)            : ${(buckets['(idle)'] / 1000).toFixed(1)}`);
console.log('');

console.log(`## Memory & DOM`);
const m = meta.metricsDelta;
console.log(`  JS heap used delta : ${(m.jsHeapUsedSize / 1e6).toFixed(2)} MB`);
console.log(`  JS heap total delta: ${(m.jsHeapTotalSize / 1e6).toFixed(2)} MB`);
console.log(`  DOM nodes added    : ${m.domNodes}`);
console.log(`  DOM listeners added: ${m.domListeners}`);
console.log(`  layout count       : ${m.layoutCount}  (${(m.layoutDuration * 1000).toFixed(1)} ms)`);
console.log(`  recalc style count : ${m.recalcStyleCount}  (${(m.recalcStyleDuration * 1000).toFixed(1)} ms)`);
console.log(`  script duration    : ${(m.scriptDuration * 1000).toFixed(1)} ms`);
console.log(`  task duration      : ${(m.taskDuration * 1000).toFixed(1)} ms`);
console.log('');

console.log(`## Network (from page load through capture)`);
console.log(`  requests: ${meta.network.requestCount}, bytes received: ${(meta.network.bytesIn / 1024).toFixed(1)} KB`);
console.log('');

console.log(`## Top ${topN} by self time`);
const list = [...folded.values()].sort((a, b) => b.self - a.self).slice(0, topN);
console.log(`${'self ms'.padStart(8)}  ${'total ms'.padStart(9)}  function (file:line)`);
console.log('-'.repeat(96));
for (const e of list) {
  const file = (e.url || '').split('/').pop() || '';
  console.log(
    `${(e.self / 1000).toFixed(1).padStart(8)}  ${(e.total / 1000).toFixed(1).padStart(9)}  ${e.name.padEnd(40).slice(0, 40)} ${file}:${e.line}`,
  );
}
