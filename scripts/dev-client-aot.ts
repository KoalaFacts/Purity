import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const test = `import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

it.each(['client', 'ssr', 'app'] as const)('scaffolds the correct AOT capability for %s', (mode) => {
  const dir = mkdtempSync(join(tmpdir(), 'purity-build-mode-'));
  try {
    execFileSync(process.execPath, [resolve(import.meta.dirname, '../src/index.ts'), 'project', ...(mode === 'client' ? [] : ['--' + mode])], { cwd: dir });
    const config = readFileSync(join(dir, 'project/vite.config.ts'), 'utf8');
    if (mode === 'client') {
      expect(config).toContain('plugins: [purity()]');
      expect(config).not.toContain('hydratable: true');
    } else {
      expect(config).toContain('hydratable: true');
      expect(config).not.toContain('strictAot: false');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
`;
writeFileSync('packages/cli/tests/build-mode.test.ts', test);
const red = spawnSync('npm', ['run', 'test', '-w', '@purityjs/cli', '--', 'tests/build-mode.test.ts'], { encoding: 'utf8' });
const redLog = (red.stdout ?? '') + (red.stderr ?? '');
writeFileSync(process.env.RUNNER_TEMP + '/aot-final/red-cli.log', redLog);
assert.notEqual(red.status, 0, 'CLI regression must fail before migration');
assert(redLog.includes('hydratable: true'), 'Unexpected CLI red-phase failure');
console.log('Confirmed SSR/app scaffold red-phase failure: generated configs omit hydration opt-in.');

function replaceOne(source: string, before: string, after: string) {
  assert.equal(source.split(before).length - 1, 1, 'Unexpected source anchor: ' + before);
  return source.replace(before, after);
}
const path = 'packages/cli/src/index.ts';
let source = readFileSync(path, 'utf8');
const old = '${appMode ? "{ routes: { dir: \'src/pages\', emitTo: \'src/.purity/routes.ts\' } }" : \'\'}';
const next = '${appMode ? "{ hydratable: true, routes: { dir: \'src/pages\', emitTo: \'src/.purity/routes.ts\' } }" : serverMode ? "{ hydratable: true }" : \'\'}';
source = replaceOne(source, old, next);
writeFileSync(path, source);
const scaffoldPath = 'packages/cli/tests/scaffold.test.ts';
let scaffold = readFileSync(scaffoldPath, 'utf8');
const ssrTest = "scaffold(['my-ssr-app', '--ssr']);\n    const config = readProjectFile('my-ssr-app', 'vite.config.ts');\n    expect(config).toContain('plugins: [purity()]');";
scaffold = replaceOne(scaffold, ssrTest, ssrTest.replace('purity()', 'purity({ hydratable: true })'));
scaffold = replaceOne(scaffold, 'plugins: [purity({ routes:', 'plugins: [purity({ hydratable: true, routes:');
writeFileSync(scaffoldPath, scaffold);

const planPath = 'docs/superpowers/plans/2026-10-28-client-first-aot.md';
let plan = readFileSync(planPath, 'utf8');
for (const item of ['Implement `hydratable?: boolean`', 'Emit direct create calls', 'Execute new behavior/security/disposal tests', 'Preserve historical full-hydration size profiles', 'Document the breaking migration']) {
  plan = plan.replace('- [ ] ' + item, '- [x] ' + item);
}
plan += '\n## Implementation receipt\n\nCompiler implementation `d7615346` passed pinned Node24 format/lint/types/workspace tests/builds and all original full-app/chunk non-growth checks in preflight 40594390437. The CLI generated SSR/app configuration required an additional explicit hydration migration, with its own observed failing test before the fix. Formal exact-head CI and independent review remain mandatory; no merge or Solid ranking follows from preflight.\n';
writeFileSync(planPath, plan);
for (const file of ['.github/workflows/dev-toolchain-recovery.yml', '.github/workflows/client-aot-preflight.yml']) unlinkSync(file);
console.log('Applied CLI migration and removed branch-only execution/recovery workflows.');
