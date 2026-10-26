// SV2-015: archive the existing runner's raw samples AFTER the timed regions.
// This is a historical-locked benchmark report, not a matched Solid v2 rc.18 result.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';

export interface BenchRunOrder {
  phase: 'timing' | 'memory';
  scenario: string;
  operation: string;
  frameworks: string[];
}

export interface BenchError {
  phase: 'timing' | 'memory';
  scenario: string;
  operation: string;
  framework: string;
  message: string;
}

interface TimingSample {
  scenario: string;
  category: string;
  op: string;
  framework: string;
  median: number;
  raw: number[];
}

interface MemorySample {
  category: string;
  op: string;
  framework: string;
  createKB: number;
  retainedKB: number;
  createSamplesKB: number[];
  retainedSamplesKB: number[];
}

export interface BenchRunInput {
  browserVersion: string;
  frameworks: string[];
  scenarioPages: string[];
  settings: {
    warmup: number;
    iterations: number;
    memoryIterations: number;
    dropOutliers: number;
    port: number;
  };
  executionOrder: BenchRunOrder[];
  timings: TimingSample[];
  memory: MemorySample[];
  errors: BenchError[];
}

interface EvidenceProvenance {
  sourceRevision: string;
  sourceDirty: boolean;
  rootLockfileSHA256: string;
  targetMetadataSHA256: string;
  lockedVersions: Record<string, string | null>;
}

const PACKAGE_NAMES = [
  'solid-js',
  '@solidjs/signals',
  '@solidjs/web',
  '@solidjs/vite-plugin',
  '@purityjs/core',
  '@purityjs/vite-plugin',
  'vite-plus',
  'vite',
] as const;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Collect actual checkout/lock identities, not the desired target manifest versions. */
export function collectBenchProvenance(
  root = resolve(import.meta.dirname, '../..'),
): EvidenceProvenance {
  const lockBytes = readFileSync(resolve(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8')) as {
    packages?: Record<string, { version?: string }>;
  };
  if (!lock.packages) throw new Error('Benchmark evidence requires npm lockfile package entries');
  const lockedVersions: Record<string, string | null> = {};
  for (const name of PACKAGE_NAMES) {
    const registry = lock.packages[`node_modules/${name}`]?.version;
    let workspace: string | undefined;
    if (name === '@purityjs/core') workspace = lock.packages['packages/core']?.version;
    if (name === '@purityjs/vite-plugin') {
      workspace = lock.packages['packages/vite-plugin']?.version;
    }
    lockedVersions[name] = registry ?? workspace ?? null;
  }
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  });
  const sourceDirty = status.trim().length > 0;
  const targetBytes = readFileSync(resolve(root, 'benchmark/solid-v2/target.json'));
  return {
    sourceRevision,
    sourceDirty,
    rootLockfileSHA256: sha256(lockBytes),
    targetMetadataSHA256: sha256(targetBytes),
    lockedVersions,
  };
}

/** Exposed separately so unit tests can write with synthetic provenance. */
export function writeBenchEvidence(
  input: BenchRunInput,
  provenance: EvidenceProvenance,
  directory: string,
): string {
  const capturedAtUTC = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    capturedAtUTC,
    purpose: 'Historical production benchmark; not a matched Solid v2 rc.18 comparison',
    provenance,
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus()[0]?.model ?? 'unavailable',
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      chromiumVersion: input.browserVersion,
    },
    settings: input.settings,
    frameworks: input.frameworks,
    scenarioPages: input.scenarioPages,
    executionOrder: input.executionOrder,
    timings: input.timings,
    memory: input.memory,
    errors: input.errors,
    complete: input.errors.length === 0,
    solidV2Rc18Installed:
      provenance.lockedVersions['solid-js'] === '2.0.0-rc.18' &&
      provenance.lockedVersions['@solidjs/signals'] === '2.0.0-rc.18' &&
      provenance.lockedVersions['@solidjs/web'] === '2.0.0-rc.18' &&
      provenance.lockedVersions['@solidjs/vite-plugin'] === '3.0.0-next.51',
    measurementNotes: {
      timing: 'Each raw value is page-side click(s) + microtask flush + forced layout in ms.',
      memory:
        'Raw values are usedJSHeapSize KB deltas after forced GC, not allocation sampling.',
      comparability: 'A version tag alone does not prove same-workload or application parity.',
    },
  };
  mkdirSync(directory, { recursive: true });
  // Exclusive creation prevents overwriting evidence from any prior run.
  const fileName = [
    capturedAtUTC.replace(/[:.]/g, '-'),
    provenance.sourceRevision.slice(0, 12),
    randomUUID(),
  ].join('-');
  const file = join(directory, `${fileName}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return file;
}

export function persistBenchRun(input: BenchRunInput): string {
  return writeBenchEvidence(
    input,
    collectBenchProvenance(),
    resolve(import.meta.dirname, '../dist/benchmark-runs'),
  );
}
