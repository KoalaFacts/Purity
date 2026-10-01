// Adapted from the inspector retention draft. Never read nodes(): its lazy
// pruning would hide missing automatic cleanup when DevTools is unopened.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setImmediate as nextJob, setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const cycles = 12;
const signalsPerCycle = 50_000;
const maxGrowthBytes = 8 * 1024 * 1024;
const prefix = 'INSPECTOR_RETENTION_RESULT ';
type Format = 'esm' | 'cjs';
interface Result {
  format: Format;
  disabled: boolean;
  heaps: number[];
  growthBytes: number;
  inspectorCalls: number;
  reason: 'plateau' | 'heap_growth';
}

if (process.argv.includes('--child')) {
  const collect = globalThis.gc;
  assert.ok(collect, 'The child process requires --expose-gc');
  const format: Format = process.argv.includes('--cjs') ? 'cjs' : 'esm';
  const disabled = process.argv.includes('--disable-cleanup');
  if (disabled) {
    // Test-only mutation in this isolated process: registration never schedules cleanup.
    globalThis.FinalizationRegistry = class {
      register(): void {}
    } as unknown as typeof FinalizationRegistry;
  }
  const { state } =
    format === 'esm'
      ? await import('../dist/index.js')
      : (createRequire(import.meta.url)('../dist/index.cjs') as typeof import('../src/signals.ts'));
  let inspectorCalls = 0;
  const hook = (globalThis as unknown as { __purity_inspect__: { nodes(): unknown[] } })
    .__purity_inspect__;
  assert.ok(hook, 'The built package must install its inspector hook');
  hook.nodes = () => {
    inspectorCalls++;
    throw new Error('Measurement must not prune the inspector');
  };

  function churn(): void {
    for (let index = 0; index < signalsPerCycle; index++) state(index);
  }
  const heaps: number[] = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    churn();
    // WeakRef targets survive their creating job. Yield before GC and allow
    // finalizers to run between collections instead of assuming synchronous GC.
    await nextJob();
    for (let attempt = 0; attempt < 4; attempt++) {
      collect();
      await delay(25);
    }
    collect();
    heaps.push(process.memoryUsage().heapUsed);
  }
  const median = (values: number[]): number => [...values].sort((a, b) => a - b)[1];
  // Ignore two warm-up cycles. Check every subsequent sample against the early
  // median, including transient peaks rather than only the final heap sample.
  const baseline = median(heaps.slice(2, 5));
  const growthBytes = Math.max(...heaps.slice(5)) - baseline;
  const reason = growthBytes > maxGrowthBytes ? 'heap_growth' : 'plateau';
  const result: Result = { format, disabled, heaps, growthBytes, inspectorCalls, reason };
  console.log(prefix + JSON.stringify(result));
  if (reason === 'heap_growth') process.exitCode = 1;
} else {
  const run = promisify(execFile);
  const lines: string[] = [];
  for (const format of ['esm', 'cjs'] as const) {
    for (const disabled of [false, true]) {
      const args = [
        '--expose-gc',
        '--experimental-strip-types',
        fileURLToPath(import.meta.url),
        '--child',
      ];
      if (format === 'cjs') args.push('--cjs');
      if (disabled) args.push('--disable-cleanup');
      let stdout = '';
      let exitCode = 0;
      try {
        ({ stdout } = await run(process.execPath, args, {
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        }));
      } catch (error) {
        const failure = error as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
        };
        // A timeout, signal, or unrelated crash cannot satisfy the negative control.
        if (failure.killed || failure.code !== 1 || !failure.stdout?.includes(prefix)) throw error;
        stdout = failure.stdout;
        exitCode = 1;
      }
      const report = stdout.split(/\r?\n/).find((line) => line.startsWith(prefix));
      assert.ok(report, `${format}: child did not produce a memory measurement`);
      const result = JSON.parse(report.slice(prefix.length)) as Result;
      assert.equal(result.format, format);
      assert.equal(result.disabled, disabled);
      assert.equal(result.inspectorCalls, 0, 'Inspection must not hide registry growth');
      assert.equal(result.heaps.length, cycles);
      assert.ok(result.heaps.every((heap) => Number.isFinite(heap) && heap > 0));
      assert.equal(
        exitCode,
        disabled ? 1 : 0,
        `${format}: disabled cleanup must fail and real cleanup must pass`,
      );
      assert.equal(result.reason, disabled ? 'heap_growth' : 'plateau');
      assert.equal(result.growthBytes > maxGrowthBytes, disabled);
      const samples = result.heaps.map((heap) => (heap / 1024 / 1024).toFixed(2)).join(' → ');
      const line = `${format.toUpperCase()} cleanup ${disabled ? 'disabled (expected rejection)' : 'enabled'}: ${samples} MiB; growth ${(result.growthBytes / 1024 / 1024).toFixed(2)} / 8 MiB; inspector calls 0`;
      console.log(line);
      lines.push(line);
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Inspector registry retention\n\n${lines.map((line) => `- ${line}`).join('\n')}\n`,
    );
  }
}
