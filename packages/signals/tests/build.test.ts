import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';

function inspectBuild(path: string, nodeEnv: string) {
  const url = pathToFileURL(resolve(import.meta.dirname, '..', path)).href;
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    const { state } = await import(${JSON.stringify(url)});
    const value = state(7);
    const inspector = globalThis.__purity_inspect__;
    console.log(JSON.stringify({ value: value(), inspected: Boolean(inspector?.nodes().some(n => n.value === 7)) }));
  `,
    ],
    { encoding: 'utf8', env: { ...process.env, NODE_ENV: nodeEnv } },
  );
}

describe('production and development artifacts', () => {
  it('keeps the development inspector even when the host runs in production mode', () => {
    const result = inspectBuild('dist/index.js', 'production');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ value: 7, inspected: true });
  });

  it('removes inspection machinery from the production artifact', () => {
    const result = inspectBuild('dist/prod/index.js', 'development');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ value: 7, inspected: false });
    const source = readFileSync(resolve(import.meta.dirname, '../dist/prod/index.js'), 'utf8');
    expect(source).not.toMatch(/WeakRef|FinalizationRegistry|__purity_inspect__/);
  });
});
