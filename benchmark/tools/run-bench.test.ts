// @vitest-environment node
// Synthetic runner control flow: never starts a browser or measures performance.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

const root = resolve(import.meta.dirname, '../..');
const files: string[] = [];
afterEach(() => {
  for (const file of files.splice(0)) rmSync(file);
});

function run(mode = 'valid', settings: Record<string, string | undefined> = {}) {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      resolve(import.meta.dirname, 'fixtures/runner-playwright.ts'),
      'benchmark/run-bench.ts',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PROBE_MODE: mode,
        PORT: '4173',
        WARMUP: '0',
        ITERATIONS: '3',
        MEM_ITERATIONS: '2',
        FRAMEWORKS: 'purity',
        PAGES: 'index',
        ...settings,
      },
    },
  );
  expect(result.error).toBeUndefined();
  const output = result.stdout + result.stderr;
  const paths = [...output.matchAll(/(?:Raw evidence|evidence): (.+\.json)/g)].map((m) => m[1]);
  files.push(...paths);
  expect(paths, output).toHaveLength(1);
  const report = JSON.parse(readFileSync(paths[0], 'utf8'));
  return { exit: result.status, report };
}

describe('benchmark runner evidence (synthetic browser)', () => {
  it('writes complete synthetic control data and labels disabled memory', () => {
    const { exit, report } = run('valid', { MEM_ITERATIONS: '0' });
    expect(exit).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.environment.chromiumVersion).toBe('SYNTHETIC-NO-BROWSER');
    expect(report.timings[0].raw).toEqual([5, 5, 5]);
    expect(report.memoryCoverage).toBe('disabled');
    expect(report.memory).toEqual([]);
  });

  it.each(['ITERATIONS', 'WARMUP', 'MEM_ITERATIONS', 'PORT'])(
    'rejects malformed %s tokens without silently normalizing the workload',
    (name) => {
      for (const token of ['7junk', '7.5', '', ' ', 'Infinity', '0x10', '9007199254740992']) {
        const { exit, report } = run('launch', { [name]: token });
        expect(exit).toBe(1);
        expect(report.complete).toBe(false);
        expect(report.environment.chromiumVersion).toBe('not-launched');
        expect(report.rawSettings[name]).toBe(token);
        expect(
          report.errors.some((error: { operation: string }) => error.operation === 'settings'),
        ).toBe(true);
        expect(report.timings).toEqual([]);
      }
    },
  );

  it('uses defaults only for unset numeric inputs', () => {
    const { exit, report } = run('valid', {
      WARMUP: undefined,
      ITERATIONS: undefined,
      MEM_ITERATIONS: undefined,
      PORT: undefined,
    });
    expect(exit).toBe(0);
    expect(report.settings).toEqual({
      warmup: 3,
      iterations: 7,
      memoryIterations: 3,
      dropOutliers: 1,
      port: 4173,
    });
  });

  it.each(['0', '-1', '2'])('archives invalid iteration count %s before launch', (token) => {
    const { exit, report } = run('launch', { ITERATIONS: token });
    expect(exit).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.environment.chromiumVersion).toBe('not-launched');
  });

  it('retains timing samples collected before an iteration fails', () => {
    const { exit, report } = run('partial-timing');
    expect(exit).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.timings[0].raw).toEqual([5]);
    expect(report.errors[0].message).toContain('second timing');
  });

  it('retains heap samples collected before an iteration fails', () => {
    const { exit, report } = run('partial-memory');
    expect(exit).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.memory[0].createSamplesKB).toEqual([2]);
    expect(report.memory[0].retainedSamplesKB).toEqual([1]);
  });

  it.each(['new-page', 'page-close', 'browser-close', 'no-memory'])(
    'archives %s failure with a nonzero process result',
    (mode) => {
      const { exit, report } = run(mode);
      expect(exit).toBe(1);
      expect(report.complete).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
      if (mode !== 'new-page') expect(report.timings[0].raw).toEqual([5, 5, 5]);
      if (mode === 'browser-close') expect(report.errors[0].operation).toBe('browser.close');
    },
  );

  it('retains the create sample when the following destroy measurement fails', () => {
    const { exit, report } = run('destroy-memory');
    expect(exit).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.memory[0].createSamplesKB).toEqual([2]);
    expect(report.memory[0].retainedSamplesKB).toEqual([]);
  });

  it.each(['FRAMEWORKS', 'PAGES'])('archives invalid %s selection before launch', (name) => {
    const { exit, report } = run('launch', { [name]: 'unknown' });
    expect(exit).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.environment.chromiumVersion).toBe('not-launched');
    expect(report.rawSettings[name]).toBe('unknown');
    expect(report.errors[0].operation).toBe('settings');
  });

  it('archives launch failure without inventing samples', () => {
    const { exit, report } = run('launch');
    expect(exit).toBe(1);
    expect(report.complete).toBe(false);
    expect(report.errors[0].operation).toBe('browser.launch');
    expect(report.timings).toEqual([]);
    expect(report.memory).toEqual([]);
  });
});
