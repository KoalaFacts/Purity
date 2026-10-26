import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { writeBenchEvidence, type BenchRunInput } from './run-evidence.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const input: BenchRunInput = {
  browserVersion: '156.0.0.0',
  frameworks: ['solid', 'purity'],
  scenarioPages: ['binding'],
  settings: {
    warmup: 1,
    iterations: 3,
    memoryIterations: 2,
    dropOutliers: 0,
    port: 4173,
  },
  executionOrder: [
    {
      phase: 'timing',
      scenario: 'binding',
      operation: 'update',
      frameworks: ['purity', 'solid'],
    },
  ],
  timings: [
    {
      scenario: 'binding',
      category: 'Update',
      op: 'update',
      framework: 'purity',
      median: 3,
      raw: [5, 3, 2],
    },
  ],
  memory: [
    {
      category: 'Memory',
      op: 'create',
      framework: 'purity',
      createKB: 2,
      retainedKB: 1,
      createSamplesKB: [2.5, 1.5],
      retainedSamplesKB: [1.5, 0.5],
    },
  ],
  errors: [],
};
const provenance = {
  sourceRevision: 'a'.repeat(40),
  sourceDirty: false,
  rootLockfileSHA256: 'b'.repeat(64),
  targetMetadataSHA256: 'c'.repeat(64),
  lockedVersions: {
    'solid-js': '2.0.0-rc.15',
    '@solidjs/signals': '2.0.0-rc.15',
    '@solidjs/web': '2.0.0-rc.14',
    '@solidjs/vite-plugin': '3.0.0-next.50',
  },
};

describe('SV2-015 raw benchmark evidence', () => {
  it('persists every raw timing, memory sample and randomized run order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'purity-bench-evidence-'));
    temporaryDirectories.push(dir);
    const file = writeBenchEvidence(input, provenance, dir);
    const report = JSON.parse(readFileSync(file, 'utf8'));
    expect(report.schemaVersion).toBe(1);
    expect(report.complete).toBe(true);
    expect(report.solidV2Rc18Installed).toBe(false);
    expect(report.timings[0].raw).toEqual([5, 3, 2]);
    expect(report.memory[0].createSamplesKB).toEqual([2.5, 1.5]);
    expect(report.memory[0].retainedSamplesKB).toEqual([1.5, 0.5]);
    expect(report.executionOrder[0].frameworks).toEqual(['purity', 'solid']);
    expect(report.provenance.sourceRevision).toBe('a'.repeat(40));
  });

  it('keeps failed runs auditable, and never overwrites an earlier report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'purity-bench-evidence-'));
    temporaryDirectories.push(dir);
    const errorInput: BenchRunInput = {
      ...input,
      errors: [
        {
          phase: 'timing',
          scenario: 'binding',
          operation: 'update',
          framework: 'solid',
          message: 'selector missing',
        },
      ],
    };
    const first = writeBenchEvidence(errorInput, provenance, dir);
    const firstText = readFileSync(first, 'utf8');
    const second = writeBenchEvidence(errorInput, provenance, dir);
    expect(first).not.toBe(second);
    expect(readFileSync(first, 'utf8')).toBe(firstText);
    const report = JSON.parse(readFileSync(second, 'utf8'));
    expect(report.complete).toBe(false);
    expect(report.errors[0].message).toBe('selector missing');
    expect(report.measurementNotes.memory).toContain('not allocation sampling');
  });
});
