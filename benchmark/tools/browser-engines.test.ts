// @vitest-environment node
// Browser checks select engines through browser-engines.ts so a machine with
// only Chromium can run them (`… chromium`) while CI still runs all three.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const root = resolve(import.meta.dirname, '../..');
const engines = resolve(import.meta.dirname, 'browser-engines.ts');

function select(args: string[], env: Record<string, string | undefined> = {}) {
  const probe = `const { browserEngines } = await import(${JSON.stringify(engines)}); console.log(browserEngines.map(([n]) => n).join(','));`;
  const childEnv = { ...process.env, ...env };
  if (env.CI === undefined) delete childEnv.CI;
  return spawnSync(process.execPath, ['--input-type=module', '-e', probe, 'probe', ...args], {
    encoding: 'utf8',
    env: childEnv,
  });
}

function scripts(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scripts(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('browser engine selection', () => {
  it('runs every engine by default and one engine when named', () => {
    expect(select([]).stdout.trim()).toBe('chromium,firefox,webkit');
    expect(select(['chromium']).stdout.trim()).toBe('chromium');
  });

  it('rejects unknown engines and engine selection on CI', () => {
    expect(select(['edge']).status).not.toBe(0);
    expect(select(['chromium'], { CI: 'true' }).status).not.toBe(0);
  });

  it('no smoke or browser check hard-codes all three engines', () => {
    const dirs = [
      'benchmark/tools',
      'examples',
      ...readdirSync(join(root, 'packages')).flatMap((pkg) => [
        `packages/${pkg}/scripts`,
        `packages/${pkg}/tests`,
      ]),
    ];
    const offenders: string[] = [];
    for (const dir of dirs) {
      let files: string[];
      try {
        files = scripts(join(root, dir));
      } catch {
        continue; // package without scripts/ or tests/
      }
      for (const file of files) {
        if (/\[\s*chromium\s*,\s*firefox\s*,\s*webkit\s*\]/.test(readFileSync(file, 'utf8')))
          offenders.push(relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
