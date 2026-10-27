/**
 * SV2-015: compare archived, unmodified bundle-size report.json artifacts.
 * Run with Node 24; no installation or network is needed for the comparison.
 * Source head SHAs must be verified against the GitHub workflow separately:
 * a PR checkout may report its temporary merge revision.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import currentBudgets from './budgets.json' with { type: 'json' };
import legacyBudgets from './budgets-v3.json' with { type: 'json' };

interface Size {
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}
interface Chunk extends Size {
  file: string;
}
interface Entry extends Size {
  entry?: string;
  profile?: string;
  chunks?: Chunk[];
  functionConstructorCalls?: number;
}
interface Report {
  revision: string;
  dirty: boolean;
  schemaVersion: number;
  node: string;
  zlib: string;
  brotli: string;
  versions: Record<string, string>;
  fixtureHashes: Record<string, string>;
  settings: Record<string, unknown>;
  scope: string;
  budgets: {
    packages: Record<string, { gzipBytes?: number; brotliBytes?: number }>;
    fixtures: Record<
      string,
      { functionConstructorCalls: number; gzipBytes?: number; brotliBytes?: number }
    >;
  };
  packages: Entry[];
  measurements: Entry[];
}
interface Delta {
  name: string;
  raw: number;
  gzip: number;
  brotli: number;
  before: number;
  after: number;
  headroom?: number;
  chunks?: Delta[];
  chunkState?: 'matched' | 'added' | 'removed';
  previousFilename?: string;
  candidateFilename?: string;
  functionCallsDelta?: number;
}

function normalized(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(normalized).join(',') + ']';
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(obj)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + normalized(obj[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function unique(rows: Entry[], field: 'entry' | 'profile'): Map<string, Entry> {
  const indexed = new Map<string, Entry>();
  for (const row of rows) {
    const key = row[field];
    assert(typeof key === 'string' && key.length > 0, 'Missing entry/profile name');
    assert(!indexed.has(key), 'Duplicate entry/profile: ' + key);
    indexed.set(key, row);
  }
  return indexed;
}

function delta(name: string, before: Size, after: Size): Delta {
  for (const prop of ['rawBytes', 'gzipBytes', 'brotliBytes'] as const) {
    assert(
      Number.isSafeInteger(before[prop]) && before[prop] >= 0,
      'Invalid baseline ' + name + '.' + prop,
    );
    assert(
      Number.isSafeInteger(after[prop]) && after[prop] >= 0,
      'Invalid candidate ' + name + '.' + prop,
    );
  }
  return {
    name,
    raw: after.rawBytes - before.rawBytes,
    gzip: after.gzipBytes - before.gzipBytes,
    brotli: after.brotliBytes - before.brotliBytes,
    before: before.brotliBytes,
    after: after.brotliBytes,
  };
}

function logicalChunkName(file: string): string {
  // Vite/Rollup emits content-hashed lazy/shared chunks. The full byte totals
  // remain comparable even if a logical chunk is renamed, added or removed.
  return file.replace(/-[A-Za-z0-9_-]{8}(?=\.js$)/, '');
}

function allChunks(row: Entry, name: string): Map<string, Chunk> {
  assert(
    Array.isArray(row.chunks) && row.chunks.length > 0,
    'Missing full JS chunk inventory: ' + name,
  );
  const chunks = new Map<string, Chunk>();
  for (const chunk of row.chunks) {
    assert(
      typeof chunk.file === 'string' && chunk.file.endsWith('.js'),
      'Invalid JS chunk name: ' + name,
    );
    const identity = logicalChunkName(chunk.file);
    assert(!chunks.has(identity), 'Ambiguous logical emitted chunk: ' + name + '/' + identity);
    chunks.set(identity, chunk);
  }
  for (const prop of ['rawBytes', 'gzipBytes', 'brotliBytes'] as const) {
    assert.equal(
      row.chunks.reduce((sum, chunk) => sum + chunk[prop], 0),
      row[prop],
      'Unaccounted JS chunk bytes: ' + name + '.' + prop,
    );
  }
  return chunks;
}

// Frozen schema-3 inventory from measure.ts. Equal omissions are not evidence
// of complete coverage; future producer schemas need an explicit contract update.
const packageNames = [
  'core',
  'core-compiler',
  'core-list-runtime',
  'core-runtime',
  'core-jit',
  'core-signals',
  'core-router',
  'core-actions',
  'core-islands',
  'core-query',
  'core-internal',
  'core-all',
  'ssr',
];
const profileNames = ['counter', 'controls', 'form', 'hydration', 'resource'].flatMap((name) => [
  name + '-runtime',
  name + '-aot',
]);
const packageNamesV4 = [...packageNames, 'core-jit-client'];
const profileNamesV4 = [...profileNames, 'counter-client-runtime', 'counter-client-aot'];
const fixtureNames = [
  'counter.ts',
  'controls.ts',
  'controls-view.ts',
  'form.ts',
  'hydration.ts',
  'resource.ts',
  'controls-server.ts',
];

const fixtureNamesV4 = [...fixtureNames, 'counter-client.ts'];

function coverage(actual: string[], expected: string[], name: string, version: number) {
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `Incomplete v${version} coverage: ` + name,
  );
}

function validateReportContract(report: Report, label: string) {
  assert(report?.revision, 'Missing revision: ' + label);
  assert(report.dirty === false, 'Dirty build is not comparable');
  assert(
    report.schemaVersion === 3 || report.schemaVersion === 4,
    'Unsupported schemaVersion: ' + label,
  );
  const expanded = report.schemaVersion === 4;
  for (const key of ['node', 'zlib', 'brotli', 'scope'] as const) {
    assert(
      typeof report[key] === 'string' && report[key].trim().length > 0,
      'Missing ' + key + ': ' + label,
    );
  }
  for (const key of ['versions', 'fixtureHashes', 'settings'] as const) {
    assert(
      report[key] && typeof report[key] === 'object' && !Array.isArray(report[key]),
      'Missing ' + key + ': ' + label,
    );
  }
  coverage(
    Object.keys(report.versions),
    ['core', 'ssr', 'plugin', 'vite', 'parser'],
    label + '/versions',
    report.schemaVersion,
  );
  for (const version of Object.values(report.versions))
    assert(
      typeof version === 'string' && version.trim().length > 0,
      'Missing tool version: ' + label,
    );
  coverage(
    Object.keys(report.fixtureHashes),
    expanded ? fixtureNamesV4 : fixtureNames,
    label + '/fixtureHashes',
    report.schemaVersion,
  );
  for (const hash of Object.values(report.fixtureHashes))
    assert(
      typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash),
      'Invalid fixture SHA256: ' + label,
    );
  assert.equal(
    normalized(report.settings),
    normalized({
      target: 'es2022',
      minify: true,
      gzipLevel: 9,
      brotliQuality: 11,
      perFileCompression: true,
    }),
    'Missing or changed v3 settings: ' + label,
  );
  for (const [name, limit] of [
    ['core-actions', 5248],
    ['core-all', 40704],
  ] as const) {
    assert.equal(
      report.budgets?.packages?.[name]?.brotliBytes,
      limit,
      'Original Brotli budget missing or changed: ' + name,
    );
  }
  assert.equal(
    normalized(report.budgets),
    normalized(expanded ? currentBudgets : legacyBudgets),
    'Missing or changed v' + report.schemaVersion + ' budgets: ' + label,
  );
  assert(Array.isArray(report.packages), 'Missing package entries: ' + label);
  assert(Array.isArray(report.measurements), 'Missing application profiles: ' + label);
  coverage(
    [...unique(report.packages, 'entry').keys()],
    expanded ? packageNamesV4 : packageNames,
    label + '/packages',
    report.schemaVersion,
  );
  coverage(
    [...unique(report.measurements, 'profile').keys()],
    expanded ? profileNamesV4 : profileNames,
    label + '/measurements',
    report.schemaVersion,
  );
  for (const row of [...report.packages, ...report.measurements]) {
    assert(
      Number.isSafeInteger(row.functionConstructorCalls) && row.functionConstructorCalls! >= 0,
      'Incomplete Function constructor evidence: ' + label + '/' + (row.entry ?? row.profile),
    );
  }
  for (const row of report.measurements) allChunks(row, label + '/' + row.profile);
}

export function compareSizeReports(base: Report, candidate: Report) {
  validateReportContract(base, 'baseline');
  validateReportContract(candidate, 'candidate');
  for (const key of [
    'schemaVersion',
    'node',
    'zlib',
    'brotli',
    'versions',
    'fixtureHashes',
    'settings',
    'scope',
    'budgets',
  ] as const) {
    assert.equal(normalized(base[key]), normalized(candidate[key]), 'INCOMPARABLE: changed ' + key);
  }
  const match = (kind: 'packages' | 'measurements'): Delta[] => {
    const field = kind === 'packages' ? 'entry' : 'profile';
    const a = unique(base[kind], field);
    const b = unique(candidate[kind], field);
    assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'Changed entry coverage: ' + kind);
    return [...a].map(([name, old]) => {
      const next = b.get(name)!;
      const change = delta(name, old, next);
      if (kind === 'packages') {
        const budget = base.budgets.packages[name]?.brotliBytes;
        if (budget !== undefined) change.headroom = budget - next.brotliBytes;
      } else {
        const oldChunks = allChunks(old, 'baseline/' + name);
        const newChunks = allChunks(next, 'candidate/' + name);
        const identities = [...new Set([...oldChunks.keys(), ...newChunks.keys()])].sort();
        const empty: Size = { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 };
        change.chunks = identities.map((identity) => {
          const beforeChunk = oldChunks.get(identity);
          const afterChunk = newChunks.get(identity);
          const diff = delta(identity, beforeChunk ?? empty, afterChunk ?? empty);
          diff.chunkState =
            beforeChunk && afterChunk ? 'matched' : beforeChunk ? 'removed' : 'added';
          diff.previousFilename = beforeChunk?.file;
          diff.candidateFilename = afterChunk?.file;
          return diff;
        });
      }
      if (
        old.functionConstructorCalls !== undefined ||
        next.functionConstructorCalls !== undefined
      ) {
        assert(
          Number.isSafeInteger(old.functionConstructorCalls) &&
            Number.isSafeInteger(next.functionConstructorCalls),
          'Incomplete Function constructor evidence: ' + name,
        );
        change.functionCallsDelta = next.functionConstructorCalls! - old.functionConstructorCalls!;
      }
      return change;
    });
  };
  const packages = match('packages');
  const apps = match('measurements');
  // Raw and gzip regressions matter even if Brotli happens to shrink.
  const grows = (item: Delta) => item.raw > 0 || item.gzip > 0 || item.brotli > 0;
  const chunkGrowth = apps.flatMap((app) =>
    (app.chunks ?? [])
      .filter(grows)
      .map((chunk) => ({ ...chunk, name: `${app.name}/${chunk.name}` })),
  );
  return {
    baseRevision: base.revision,
    candidateRevision: candidate.revision,
    packages,
    apps,
    packageGrowth: packages.filter(grows),
    appGrowth: apps.filter(grows),
    chunkGrowth,
    budgetViolations: packages.filter((x) => x.headroom !== undefined && x.headroom < 0),
  };
}

if (process.argv[1]?.endsWith('compare-reports.ts')) {
  const [, , baseFile, candidateFile, ...flags] = process.argv;
  assert(
    baseFile && candidateFile,
    'Usage: compare-reports.ts BASE.json CANDIDATE.json [--reject-app-growth]',
  );
  assert(
    flags.every((x) => x === '--reject-app-growth'),
    'Unsupported flag',
  );
  const [base, candidate] = await Promise.all(
    [baseFile, candidateFile].map(
      async (path) => JSON.parse(await readFile(path, 'utf8')) as Report,
    ),
  );
  const result = compareSizeReports(base, candidate);
  const signed = (n: number) => (n > 0 ? '+' : '') + n;
  console.log('CI report revisions: ' + result.baseRevision + ' → ' + result.candidateRevision);
  console.log('Matched fixtures, Node/Vite/compiler, compression settings and original budgets.');
  console.log(
    '| Package / application / emitted JS chunk | Before Brotli | After Brotli | Change | Budget headroom |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: |');
  for (const row of [...result.packages, ...result.apps]) {
    console.log(
      '| ' +
        row.name +
        ' | ' +
        row.before +
        ' | ' +
        row.after +
        ' | ' +
        signed(row.brotli) +
        ' | ' +
        (row.headroom ?? 'n/a') +
        ' |',
    );
    for (const chunk of row.chunks ?? []) {
      const source = chunk.previousFilename ?? '(new)';
      const target = chunk.candidateFilename ?? '(removed)';
      console.log(
        '| ↳ ' +
          row.name +
          '/' +
          chunk.name +
          ' [' +
          chunk.chunkState +
          ': ' +
          source +
          ' → ' +
          target +
          '] | ' +
          chunk.before +
          ' | ' +
          chunk.after +
          ' | ' +
          signed(chunk.brotli) +
          ' | n/a |',
      );
    }
  }
  console.log(
    'Application payload regressions: ' + result.appGrowth.length + ' / ' + result.apps.length,
  );
  console.log('Required JS chunk payload regressions: ' + result.chunkGrowth.length);
  console.log(
    'No performance, allocation, retained-heap or Solid parity claim follows from size alone.',
  );
  assert.equal(result.budgetViolations.length, 0, 'Original package Brotli budget exceeded');
  if (flags.includes('--reject-app-growth')) {
    assert.equal(result.appGrowth.length, 0, 'Same-function app JS payload grew');
    assert.equal(result.chunkGrowth.length, 0, 'Individual JS chunk payload grew');
  }
}
