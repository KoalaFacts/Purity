// @vitest-environment node
// Browser checks select engines through browser-engines.ts so a machine with
// only Chromium can run them (`… chromium`) while CI still runs all three.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const root = resolve(import.meta.dirname, '../..');
const engines = resolve(import.meta.dirname, 'browser-engines.ts');
// The a11y scanners take a page URL as their argument, which browser-engines.ts
// would reject; they always scan every engine (README: Accessibility fixtures).
const allEngineScanners = new Set([
  'benchmark/tools/a11y-form-check.ts',
  'benchmark/tools/a11y-matrix.ts',
]);

function select(args: string[], env: Record<string, string | undefined> = {}) {
  const probe = `const { browserEngines } = await import(${JSON.stringify(engines)}); console.log(browserEngines.map(([n]) => n).join(','));`;
  const childEnv = { ...process.env, ...env };
  if (env.CI === undefined) delete childEnv.CI;
  return spawnSync(process.execPath, ['--input-type=module', '-e', probe, 'probe', ...args], {
    encoding: 'utf8',
    env: childEnv,
  });
}

function launchChromium(env: Record<string, string>, launchOptions = '') {
  const probe = `const { browserEngines } = await import(${JSON.stringify(engines)}); try { await browserEngines[0][1].launch(${launchOptions}); console.log('launched'); } catch (error) { console.log(String(error.message)); }`;
  const childEnv = { ...process.env, ...env };
  delete childEnv.CI;
  return spawnSync(process.execPath, ['--input-type=module', '-e', probe, 'probe', 'chromium'], {
    encoding: 'utf8',
    env: childEnv,
  }).stdout;
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

function checkDirs(extra: string[] = []): string[] {
  return [
    ...extra,
    'benchmark/tools',
    'examples',
    ...readdirSync(join(root, 'packages')).flatMap((pkg) => [
      `packages/${pkg}/scripts`,
      `packages/${pkg}/tests`,
    ]),
  ].filter((dir) => existsSync(join(root, dir))); // packages without scripts/ or tests/
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

  it('launches Chromium from CHROMIUM_PATH, and an explicit executablePath still wins', () => {
    const missing = join(root, 'no-such-dir', 'chrome-from-env');
    expect(launchChromium({ CHROMIUM_PATH: missing })).toContain(missing);
    const explicit = join(root, 'no-such-dir', 'chrome-explicit');
    const out = launchChromium(
      { CHROMIUM_PATH: missing },
      `{ executablePath: ${JSON.stringify(explicit)} }`,
    );
    expect(out).toContain(explicit);
    expect(out).not.toContain(missing);
  });

  it('no browser check or scanner imports Playwright engines around CHROMIUM_PATH', () => {
    const offenders: string[] = [];
    // The bundle-size verifiers run every engine on purpose (no selector), so
    // only this rule scans them.
    for (const dir of checkDirs(['benchmark/bundle-size'])) {
      for (const file of scripts(join(root, dir))) {
        const source = readFileSync(file, 'utf8');
        if (
          /import\s*\{[^}]*\b(?:chromium|firefox|webkit)\b[^}]*\}\s*from\s*'playwright'/.test(
            source,
          ) &&
          !source.includes('CHROMIUM_PATH')
        )
          offenders.push(relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no smoke or browser check hard-codes all three engines', () => {
    const offenders: string[] = [];
    for (const dir of checkDirs()) {
      for (const file of scripts(join(root, dir))) {
        if (allEngineScanners.has(relative(root, file))) continue;
        if (
          /\bof\s+(?:Object\.entries\(\s*)?[[{]\s*chromium\s*,\s*firefox\s*,\s*webkit\s*[\]}]/.test(
            readFileSync(file, 'utf8'),
          )
        )
          offenders.push(relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
