import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  validateBenchRunInput,
  validateBenchSettings,
  writeBenchEvidence,
  type BenchRunInput,
} from './run-evidence.ts';

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
    {
      phase: 'memory',
      scenario: 'binding',
      operation: 'create',
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
    {
      scenario: 'binding',
      category: 'Update',
      op: 'update',
      framework: 'solid',
      median: 3,
      raw: [5, 3, 2],
    },
  ],
  memory: [
    {
      scenario: 'binding',
      category: 'Memory',
      op: 'create',
      framework: 'purity',
      createKB: 2,
      retainedKB: 1,
      createSamplesKB: [2.5, 1.5],
      retainedSamplesKB: [1.5, 0.5],
    },
    {
      scenario: 'binding',
      category: 'Memory',
      op: 'create',
      framework: 'solid',
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
  it('rejects invalid or empty sampling settings instead of declaring success', () => {
    expect(validateBenchSettings({ ...input.settings, iterations: 0 })).not.toEqual([]);
    expect(validateBenchSettings({ ...input.settings, iterations: Number.NaN })).not.toEqual([]);
    expect(validateBenchSettings({ ...input.settings, iterations: 2 })).not.toEqual([]);
    expect(validateBenchSettings({ ...input.settings, warmup: -1 })).not.toEqual([]);
    expect(validateBenchSettings({ ...input.settings, memoryIterations: -1 })).not.toEqual([]);
    const sample = structuredClone(input);
    sample.settings.iterations = 0;
    const dir = mkdtempSync(join(tmpdir(), 'purity-bench-evidence-'));
    temporaryDirectories.push(dir);
    const report = JSON.parse(readFileSync(writeBenchEvidence(sample, provenance, dir), 'utf8'));
    expect(report.complete).toBe(false);
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });

  it('rejects missing frameworks, raw samples and non-finite medians', () => {
    const missing = structuredClone(input);
    missing.timings.pop();
    expect(validateBenchRunInput(missing).join(' ')).toContain('exactly one timing record');
    const incomplete = structuredClone(input);
    incomplete.timings[0].raw = [5];
    expect(validateBenchRunInput(incomplete).join(' ')).toContain('3 finite raw samples');
    const badMedian = structuredClone(input);
    badMedian.timings[0].median = Number.NaN;
    expect(validateBenchRunInput(badMedian).join(' ')).toContain('invalid timing median');
  });

  it('reports unavailable and partial memory as incomplete, not measured', () => {
    const unavailable = structuredClone(input);
    unavailable.memory[0].createSamplesKB = [];
    unavailable.memory[0].retainedSamplesKB = [];
    unavailable.memory[0].createKB = -1;
    unavailable.memory[0].retainedKB = -1;
    expect(validateBenchRunInput(unavailable).join(' ')).toContain('finite raw samples');

    const failed = structuredClone(input);
    failed.memory[0].retainedSamplesKB = [1.5];
    expect(validateBenchRunInput(failed).join(' ')).toContain('2 finite raw samples');

    const disabled = structuredClone(input);
    disabled.settings.memoryIterations = 0;
    disabled.executionOrder = disabled.executionOrder.filter((order) => order.phase === 'timing');
    disabled.memory = [];
    expect(validateBenchRunInput(disabled)).toEqual([]);
  });
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
