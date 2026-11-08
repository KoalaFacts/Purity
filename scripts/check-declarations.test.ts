import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkDeclarations } from './check-declarations.ts';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureConfig = readFileSync(
  join(repoRoot, 'scripts/declaration-consumers/tsconfig.json'),
  'utf8',
);

// Temporary consumers live under the repo's node_modules so `@purityjs/*`
// resolves through the workspace links exactly as the real gate does.
let dir = '';
function consumer(source: string, config: string = fixtureConfig): string {
  const base = join(repoRoot, 'node_modules', '.cache');
  mkdirSync(base, { recursive: true });
  dir = mkdtempSync(join(base, 'check-declarations-'));
  writeFileSync(join(dir, 'tsconfig.json'), config);
  writeFileSync(join(dir, 'consumer.ts'), source);
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const header = "import { state } from '@purityjs/signals';\nconst n = state(0);\n";

describe('check-declarations', () => {
  it('passes the real consumers against built declarations', () => {
    const report = checkDeclarations();
    assert.deepEqual(report.problems, []);
    assert.ok(report.negatives >= 25, `negatives: ${report.negatives}`);
    assert.ok(report.declarationFiles > 0);
  });

  it('passes when an intended type error is marked as a negative contract', () => {
    const report = checkDeclarations(
      consumer(`${header}// @ts-expect-error string into number\nn('x');\n`),
    );
    assert.deepEqual(report.problems, []);
    assert.equal(report.negatives, 1);
  });

  it('fails with TS2578 when a negative contract stops being an error', () => {
    const report = checkDeclarations(
      consumer(`${header}// @ts-expect-error this compiles\nn(1);\n`),
    );
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0]!, /TS2578/);
  });

  it('fails on a positive line that does not type-check', () => {
    const report = checkDeclarations(
      consumer(`${header}// @ts-expect-error ok\nn('x');\nconst s: string = n();\n`),
    );
    assert.equal(report.problems.length, 1);
    assert.match(report.problems[0]!, /TS2322/);
  });

  it('fails a consumer file without any negative contract', () => {
    const report = checkDeclarations(consumer(`${header}n(1);\n`));
    assert.deepEqual(report.problems, ['consumer.ts: no @ts-expect-error negative contract']);
  });

  it('fails when a consumer resolves package sources instead of dist declarations', () => {
    const config = JSON.parse(fixtureConfig) as { compilerOptions: Record<string, unknown> };
    config.compilerOptions.customConditions = ['development'];
    config.compilerOptions.allowImportingTsExtensions = true;
    config.compilerOptions.skipLibCheck = true;
    const report = checkDeclarations(
      consumer(
        `${header}// @ts-expect-error string into number\nn('x');\n`,
        JSON.stringify(config),
      ),
    );
    assert.ok(
      report.problems.some(
        (p) => p.includes('resolved package source') && p.includes('packages/signals/src/'),
      ),
      report.problems.join('\n'),
    );
  });
});
