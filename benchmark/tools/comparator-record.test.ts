import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// `benchmarkWorkspaceComparator` in target.json names the Solid packages that
// benchmark/run-bench.ts actually compares against. Benchmark claims must name
// the exact Solid version, so the record has to follow every Dependabot bump of
// the lockfile instead of silently going stale.
// Paths are relative to the benchmark workspace, where its tests run.
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

test('target.json records the Solid packages the benchmark workspace installs', () => {
  const lock = readJson('../package-lock.json').packages as Record<
    string,
    { version: string; integrity: string }
  >;
  const recorded = readJson('solid-v2/target.json').benchmarkWorkspaceComparator.packages as Record<
    string,
    { version: string; integrity: string }
  >;

  const names = Object.keys(recorded);
  expect(names).toEqual(['solid-js', '@solidjs/web', '@solidjs/signals', '@solidjs/vite-plugin']);
  for (const name of names) {
    const installed = lock[`node_modules/${name}`];
    expect(installed, `${name} is missing from package-lock.json`).toBeDefined();
    expect(recorded[name], name).toEqual({
      version: installed.version,
      integrity: installed.integrity,
    });
  }
});
