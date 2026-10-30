import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vite-plus/test';
import { purity } from '../src/index.ts';

const repo = resolve(import.meta.dirname, '../../..');
const fixture = `
import { when } from '@purityjs/core';
import { currentPath } from '@purityjs/router';
import { island } from '@purityjs/platform/islands';
import { state } from '@purityjs/signals';
import { renderToString } from '@purityjs/ssr';
export async function render() {
  const enabled = state(true);
  return renderToString(() => island(() => when(enabled, () => currentPath()))(),
    { request: new Request('https://example.test/edge') });
}
`;

describe('production package conditions for worker SSR', () => {
  it('preserves Vite worker defaults and leaves Node SSR configuration alone', () => {
    const plugin = purity();
    const worker = plugin.config({ ssr: { target: 'webworker' } }, {});
    expect(worker?.ssr.resolve.conditions).toEqual([
      'purity-server',
      'module',
      'browser',
      'development|production',
    ]);
    expect(worker?.ssr.resolve.externalConditions).toEqual([
      'purity-server',
      'node',
      'module-sync',
    ]);
    expect(plugin.config({ ssr: { target: 'node' } }, {})).toBeUndefined();
  });
  it('bundles server entries in webworker SSR and keeps client builds on browser entries', async () => {
    const directory = mkdtempSync(join(repo, '.edge-conditions-'));
    try {
      const entry = join(directory, 'entry.js');
      writeFileSync(entry, fixture);
      let conditions: readonly string[] = [];
      let externalConditions: readonly string[] = [];
      const compiled = await build({
        root: repo,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          purity(),
          {
            name: 'inspect-ssr-conditions',
            configResolved(config) {
              conditions = config.ssr.resolve.conditions;
              externalConditions = config.ssr.resolve.externalConditions;
            },
          },
        ],
        ssr: {
          target: 'webworker',
          noExternal: true,
          resolve: {
            conditions: ['module', 'browser', 'production', 'custom-condition'],
            externalConditions: ['node', 'custom-external'],
          },
        },
        build: { ssr: entry, write: false, minify: false },
      });
      expect(conditions).toContain('custom-condition');
      expect(conditions).toContain('purity-server');
      expect(externalConditions).toContain('custom-external');
      expect(externalConditions).toContain('purity-server');
      const output = Array.isArray(compiled) ? compiled[0] : compiled;
      const chunk = output.output.find((item) => item.type === 'chunk');
      expect(chunk).toBeDefined();
      const ids = Object.keys(chunk!.modules).map((id) => id.replaceAll('\\', '/'));
      for (const pkg of ['core', 'router', 'platform']) {
        expect(ids.some((id) => id.includes(`/packages/${pkg}/dist/browser/`))).toBe(false);
      }
      expect(ids.some((id) => id.includes('/packages/signals/dist/prod/'))).toBe(true);
      const module = await import(
        `data:text/javascript;base64,${Buffer.from(chunk!.code).toString('base64')}`
      );
      const html = await module.render();
      expect(html).toContain('/edge');
      expect(html).toContain('data-pi-id=');

      const clientEntry = join(directory, 'client.js');
      writeFileSync(
        clientEntry,
        "import { when } from '@purityjs/core'; import { currentPath } from '@purityjs/router'; import { island } from '@purityjs/platform/islands'; export const view = island(() => when(() => true, () => currentPath()));",
      );
      const clientBuild = await build({
        root: repo,
        configFile: false,
        logLevel: 'silent',
        plugins: [purity()],
        resolve: { conditions: ['module', 'browser', 'production'] },
        build: { lib: { entry: clientEntry, formats: ['es'] }, write: false, minify: false },
      });
      const client = Array.isArray(clientBuild) ? clientBuild[0] : clientBuild;
      const clientIds = client.output
        .filter((item) => item.type === 'chunk')
        .flatMap((item) => Object.keys(item.modules))
        .map((id) => id.replaceAll('\\', '/'));
      for (const pkg of ['core', 'router', 'platform']) {
        expect(clientIds.some((id) => id.includes(`/packages/${pkg}/dist/browser/`))).toBe(true);
      }
      expect(clientIds.some((id) => id.includes('/packages/signals/dist/prod/'))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);

  it.each(['production', 'development'])(
    'selects consistent %s server packages for external imports',
    (mode) => {
      const script = fixture + '\nconsole.log(await render());';
      const output = execFileSync(
        process.execPath,
        [
          ...(mode === 'development'
            ? ['--experimental-transform-types', '--disable-warning=ExperimentalWarning']
            : []),
          '--conditions=purity-server',
          '--conditions=browser',
          `--conditions=${mode}`,
          '--input-type=module',
          '-e',
          script,
        ],
        { cwd: repo, encoding: 'utf8' },
      );
      expect(output).toContain('/edge');
      expect(output).toContain('data-pi-id=');
    },
  );

  it('keeps CommonJS server packages aligned when both conditions are enabled', () => {
    const script = `
      const { when } = require('@purityjs/core');
      const { currentPath } = require('@purityjs/router');
      const { island } = require('@purityjs/platform/islands');
      const { state } = require('@purityjs/signals');
      const { renderToString } = require('@purityjs/ssr');
      renderToString(() => island(() => when(state(true), () => currentPath()))(),
        { request: new Request('https://example.test/edge') }).then(console.log);
    `;
    const output = execFileSync(
      process.execPath,
      [
        '--conditions=purity-server',
        '--conditions=browser',
        '--conditions=production',
        '-e',
        script,
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    expect(output).toContain('/edge');
    expect(output).toContain('data-pi-id=');
  });
});
